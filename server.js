// ─────────────────────────────────────────────────────────────────────────────
//  server.js
//  Backend Express - API para productos, registro de pedidos y alertas.
//
//  Endpoints:
//    GET  /api/productos        → devuelve lista de productos con stock
//    POST /api/pedido           → registra el pedido en Sheets y dispara alertas
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();

const express  = require("express");
const path     = require("path");
const crypto   = require("crypto");
const config   = require("./config");
const sheets   = require("./services/sheets");
const telegram = require("./services/telegram");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Servir frontend

// ── Autenticación por API key (Bearer) ────────────────────────────────────────
// Protege endpoints de escritura usados por clientes externos.
// La tienda pública (GET /api/productos) NO usa este middleware.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;       // timingSafeEqual exige igual longitud
  return crypto.timingSafeEqual(ba, bb);
}

function requireApiKey(req, res, next) {
  const expected = process.env.NUBEZ_API_KEY;
  if (!expected) {
    console.error("[Auth] NUBEZ_API_KEY no está configurada en el entorno.");
    return res.status(500).json({ error: "API key no configurada en el servidor." });
  }
  const header = req.get("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : null;
  if (!token || !safeEqual(token, expected)) {
    return res.status(401).json({ error: "No autorizado." });
  }
  next();
}

// ── GET /api/productos ────────────────────────────────────────────────────────
// Intenta leer desde Google Sheets; si falla, usa el fallback de config.js
app.get("/api/productos", async (req, res) => {
  let productos = await sheets.obtenerProductos();

  if (!productos) {
    console.warn("[Server] Sheets falló, usando productos de config.js");
    productos = config.productosFallback;
  } else {
    // La tienda muestra solo productos con "Precio Venta" cargado (precio > 0).
    // /api/movimiento y /api/pedido usan la lista completa (registran stock igual).
    productos = productos.filter((p) => p.precio > 0);
  }

  res.json(productos);
});

// ── GET /api/promos ───────────────────────────────────────────────────────────
// Precios de packs (fuente única: config.js). La tienda los usa para no
// hardcodearlos en el HTML/JS.
app.get("/api/promos", (req, res) => {
  res.json(config.promos);
});

// ── POST /api/pedido ──────────────────────────────────────────────────────────
// Expande packs en líneas individuales para Sheets.
// Ej: Pack Dúo $2800 con [Sour Apple, Blue Razz] → 2 filas de $1400 c/u
function expandirParaSheets(items) {
  const resultado = [];
  for (const item of items) {
    if (item.esPromo && Array.isArray(item.sabores) && item.sabores.length > 0) {
      const precioUnitario = Math.round(item.precio / item.sabores.length);
      // Agrupar sabores repetidos en una sola fila con cantidad
      const counts = {};
      for (const s of item.sabores) counts[s] = (counts[s] || 0) + 1;
      for (const [nombre, cantidad] of Object.entries(counts)) {
        resultado.push({ nombre, cantidad, precio: precioUnitario });
      }
    } else {
      resultado.push(item);
    }
  }
  return resultado;
}

// Recibe: { items: [{ id, nombre, cantidad, precio, esPromo?, sabores? }] }
// 1. Registra el movimiento en Sheets como "pedido_iniciado"
// 2. Verifica si algún producto quedó con stock bajo y envía alerta Telegram
// 3. También notifica a Telegram sobre el nuevo pedido
app.post("/api/pedido", async (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Items requeridos." });
  }

  // Calcular total
  const total = items.reduce((sum, i) => sum + i.precio * i.cantidad, 0);

  // 1. Leer la hoja ANTES de escribir: sirve para resolver el "Sabor" exacto
  //    (clave de los SUMIFS de Inventario) y para proyectar el stock restante.
  const productosAntes = await sheets.obtenerProductos();

  // Traducir cada línea al "Sabor" real (col B de Inventario). Tanto los items
  // sueltos como los sabores de los packs traen el "nombre" de config; lo
  // cambiamos por el Sabor exacto para que el SUMIFS contabilice el movimiento.
  const saborPorId     = new Map();
  const saborPorNombre = new Map();
  for (const p of productosAntes || []) {
    if (!p.sabor) continue;
    saborPorId.set(p.id, p.sabor);
    saborPorNombre.set(p.nombre, p.sabor);
  }
  const resolverSabor = (it) => {
    if (it.id != null && saborPorId.has(it.id)) return saborPorId.get(it.id);
    if (saborPorNombre.has(it.nombre))          return saborPorNombre.get(it.nombre);
    return it.nombre; // fallback: si no está en la hoja, deja el nombre original
  };
  const lineas = expandirParaSheets(items).map((it) => ({ ...it, nombre: resolverSabor(it) }));

  // 2. Registrar en Sheets (packs ya expandidos y con el Sabor real)
  const registrado = await sheets.registrarMovimiento(lineas);

  // 3. Alerta de nuevo pedido en Telegram
  await telegram.alertaNuevoPedido(items, total);

  // 4. Verificar stock bajo usando la lectura PREVIA (stock antes − lo pedido)
  const productos = productosAntes || config.productosFallback;

  for (const item of items) {
    const producto = productos.find((p) => p.id === item.id);
    if (!producto) continue;

    const stockMinimo = producto.stockMinimo || config.stock.minimoAlerta;

    // Calcular stock proyectado (aún no descontado, solo referencial)
    const stockProyectado = producto.stock - item.cantidad;

    if (stockProyectado <= 0) {
      await telegram.alertaStockBajo(producto.nombre, Math.max(0, stockProyectado));
    } else if (stockProyectado <= stockMinimo) {
      await telegram.alertaStockBajo(producto.nombre, stockProyectado);
    }
  }

  res.json({
    ok:         true,
    registrado,
    mensaje:    "Pedido iniciado. Se abrirá WhatsApp para confirmar.",
  });
});

// ── POST /api/movimiento (protegido con requireApiKey) ────────────────────────
// Permite que un cliente externo registre una venta o una compra de stock.
// Body: { tipo: "venta"|"compra", alias, cantidad, precio, comentario? }
app.post("/api/movimiento", requireApiKey, async (req, res) => {
  const { tipo, alias, cantidad, precio, comentario } = req.body || {};

  // 1. Validación de entrada
  if (tipo !== "venta" && tipo !== "compra") {
    return res.status(400).json({ error: 'El campo "tipo" debe ser "venta" o "compra".' });
  }
  if (!alias || typeof alias !== "string") {
    return res.status(400).json({ error: 'El campo "alias" es requerido.' });
  }
  const cant = Number(cantidad);
  const prc  = Number(precio);
  if (!Number.isFinite(cant) || cant <= 0) {
    return res.status(400).json({ error: 'El campo "cantidad" debe ser un número mayor a 0.' });
  }
  if (!Number.isFinite(prc) || prc < 0) {
    return res.status(400).json({ error: 'El campo "precio" debe ser un número válido (>= 0).' });
  }

  const aliasNorm = alias.trim().toLowerCase();

  // 2. Buscar el producto en la HOJA (catálogo sheet-driven). Si la hoja no está
  //    disponible, cae a config.js como fallback.
  const productosSheet = await sheets.obtenerProductos();
  let producto = (productosSheet || []).find((p) => p.alias === aliasNorm);
  if (!producto) producto = config.productosFallback.find((p) => p.alias === aliasNorm);
  if (!producto) {
    return res.status(404).json({ error: `No existe un producto con alias "${alias}".` });
  }

  // 3. Sabor EXACTO que esperan los SUMIFS de Inventario (col B)
  const saborKey = producto.sabor || producto.nombre;

  // 4. Mapear el tipo de la request a los valores de la fila de Movimientos
  const opts = tipo === "venta"
    ? { tipo: "Salida",  comprador: "whatsapp",  tipoVenta: "Venta directa", comentario: comentario || "" }
    : { tipo: "Entrada", comprador: "proveedor", tipoVenta: "Reposición",    comentario: comentario || "" };

  const registrado = await sheets.registrarMovimiento(
    [{ nombre: saborKey, cantidad: cant, precio: prc }],
    opts
  );
  if (!registrado) {
    return res.status(502).json({ error: "No se pudo registrar el movimiento en Google Sheets." });
  }

  // 5. Releer el stock actualizado del producto
  const actualizados  = (await sheets.obtenerProductos()) || config.productosFallback;
  const actualizado   = actualizados.find((p) => p.alias === aliasNorm);
  const stockRestante = actualizado && typeof actualizado.stock === "number" ? actualizado.stock : null;
  const stockMinimo   = producto.stockMinimo || config.stock.minimoAlerta;
  const stockBajo     = typeof stockRestante === "number" ? stockRestante <= stockMinimo : null;

  res.json({
    ok:           true,
    producto:     producto.nombre,
    alias:        aliasNorm,
    stockRestante,
    stockMinimo,
    stockBajo,
  });
});

// ── Iniciar servidor / exportar para Vercel ───────────────────────────────────
// En local (node server.js / nodemon) levantamos el servidor con listen().
// En Vercel (serverless) NO se hace listen: se exporta el app como handler y
// @vercel/node lo invoca por request. process.env.VERCEL viene seteado en Vercel.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n✅ Servidor corriendo en http://localhost:${PORT}`);
    console.log(`   Google Sheet ID: ${process.env.GOOGLE_SHEET_ID || "⚠️  no configurado"}`);
    console.log(`   Telegram:        ${process.env.TELEGRAM_BOT_TOKEN ? "✅ configurado" : "⚠️  no configurado"}\n`);
  });
}

// Handler serverless para Vercel (@vercel/node usa este export por request)
module.exports = app;
