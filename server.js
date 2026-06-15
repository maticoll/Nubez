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

// ── Autenticación del panel admin (clave simple) ──────────────────────────────
// El panel /admin manda la clave en el header X-Admin-Password en cada request.
// POST /api/admin/login solo valida la clave (el front la guarda en localStorage).
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    console.error("[Auth] ADMIN_PASSWORD no está configurada en el entorno.");
    return res.status(500).json({ error: "Clave de admin no configurada en el servidor." });
  }
  const provided = req.get("x-admin-password") || "";
  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({ error: "No autorizado." });
  }
  next();
}

// ── POST /api/admin/login ─────────────────────────────────────────────────────
app.post("/api/admin/login", (req, res) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    console.error("[Auth] ADMIN_PASSWORD no está configurada en el entorno.");
    return res.status(500).json({ error: "Clave de admin no configurada en el servidor." });
  }
  const { password } = req.body || {};
  if (typeof password !== "string" || !safeEqual(password, expected)) {
    return res.status(401).json({ error: "Clave incorrecta." });
  }
  res.json({ ok: true });
});

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
  const { tipo, alias, cantidad, precio, comentario, comprador } = req.body || {};

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

  // 4. Mapear el tipo de la request a los valores de la fila de Movimientos.
  //    El comentario que llega (HERMES manda "pago"/"debe") se escribe TAL CUAL (col I).
  const coment = typeof comentario === "string" ? comentario : "";
  const opts = tipo === "venta"
    ? { tipo: "Salida",  comprador: "whatsapp",  tipoVenta: "Venta directa", comentario: coment }
    : { tipo: "Entrada", comprador: "proveedor", tipoVenta: "Reposición",    comentario: coment };

  // "comprador" opcional del body: si viene (incluso ""), pisa el default por tipo.
  // "" escribe la celda G vacía; si no viene, queda el default por tipo.
  if (typeof comprador === "string") opts.comprador = comprador;

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

// ── POST /api/marcar-pago (protegido con requireApiKey) ───────────────────────
// Marca como "pago" las ventas (Salida) de un comprador que estaban en "debe".
// Body: { comprador }
app.post("/api/marcar-pago", requireApiKey, async (req, res) => {
  const { comprador } = req.body || {};
  if (typeof comprador !== "string" || !comprador.trim()) {
    return res.status(400).json({ error: 'El campo "comprador" es requerido.' });
  }

  const actualizados = await sheets.marcarPago(comprador);
  if (actualizados === null) {
    return res.status(502).json({ error: "No se pudo actualizar Movimientos en Google Sheets." });
  }

  res.json({ ok: true, comprador: comprador.trim(), actualizados });
});

// ─────────────────────────────────────────────────────────────────────────────
//  PANEL ADMIN (/admin) — lectura, métricas y acciones por fila
//  Todos los endpoints exigen requireAdmin (header X-Admin-Password).
// ─────────────────────────────────────────────────────────────────────────────

// "15/6/2026, 14:30:25" (fecha es-UY guardada en col A) → "2026-06-15" (comparable)
function fechaAISO(fechaStr) {
  const m = String(fechaStr || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function filtrarMovimientos(movs, q = {}) {
  let out = movs;
  const { desde, hasta, tipo, comprador, estado } = q;
  if (desde) out = out.filter((m) => { const iso = fechaAISO(m.fecha); return iso && iso >= desde; });
  if (hasta) out = out.filter((m) => { const iso = fechaAISO(m.fecha); return iso && iso <= hasta; });
  if (tipo)  out = out.filter((m) => m.tipo.toLowerCase() === String(tipo).toLowerCase());
  if (comprador) {
    const c = String(comprador).trim().toLowerCase();
    out = out.filter((m) => m.comprador.trim().toLowerCase().includes(c));
  }
  if (estado) {
    const e = String(estado).trim().toLowerCase();
    out = out.filter((m) => m.comentario.trim().toLowerCase() === e);
  }
  return out;
}

// Agrega métricas sobre Movimientos. Período (desde/hasta) aplica a ventas,
// ranking y "sin rotación". Deudores y "por agotarse" son all-time (deuda viva /
// stock actual). Costo unitario por sabor = promedio del precio de las Entradas.
function calcularMetricas(movs, productos, q = {}) {
  const { desde, hasta } = q;
  const enRango = (m) => {
    const iso = fechaAISO(m.fecha);
    if (desde && !(iso && iso >= desde)) return false;
    if (hasta && !(iso && iso <= hasta)) return false;
    return true;
  };

  const ventas   = movs.filter((m) => m.tipo === "Salida" && enRango(m));
  const entradas = movs.filter((m) => m.tipo === "Entrada"); // base de costo: todas

  const costoAgg = {};
  for (const e of entradas) {
    const k = e.sabor.trim();
    if (!costoAgg[k]) costoAgg[k] = { sum: 0, n: 0 };
    costoAgg[k].sum += e.precio;
    costoAgg[k].n   += 1;
  }
  const costoUnit = (sabor) => {
    const a = costoAgg[(sabor || "").trim()];
    return a && a.n ? a.sum / a.n : 0;
  };

  const totalVendido     = ventas.reduce((s, m) => s + m.total, 0);
  const unidadesVendidas = ventas.reduce((s, m) => s + m.cantidad, 0);
  const ticketPromedio   = ventas.length ? Math.round(totalVendido / ventas.length) : 0;

  const rankAgg = {};
  for (const v of ventas) {
    const k = v.sabor.trim();
    if (!rankAgg[k]) rankAgg[k] = { sabor: k, unidades: 0, ingreso: 0 };
    rankAgg[k].unidades += v.cantidad;
    rankAgg[k].ingreso  += v.total;
  }
  const ranking = Object.values(rankAgg)
    .map((r) => ({ ...r, margen: Math.round(r.ingreso - costoUnit(r.sabor) * r.unidades) }))
    .sort((a, b) => b.unidades - a.unidades);

  const margenBruto = ranking.reduce((s, r) => s + r.margen, 0);

  const vendidos = new Set(ventas.map((v) => v.sabor.trim().toLowerCase()));
  const sinRotacion = (productos || [])
    .filter((p) => !vendidos.has((p.sabor || p.nombre || "").trim().toLowerCase()))
    .map((p) => p.sabor || p.nombre);

  const deudAgg = {};
  for (const m of movs) {
    if (m.tipo === "Salida" && m.comentario.trim().toLowerCase() === "debe") {
      const k = m.comprador.trim() || "(sin nombre)";
      deudAgg[k] = (deudAgg[k] || 0) + m.total;
    }
  }
  const deudores = Object.entries(deudAgg)
    .map(([comprador, total]) => ({ comprador, total }))
    .sort((a, b) => b.total - a.total);

  const porAgotarse = (productos || [])
    .filter((p) => typeof p.stock === "number" && p.stock <= (p.stockMinimo || config.stock.minimoAlerta))
    .map((p) => ({ sabor: p.sabor || p.nombre, stock: p.stock, minimo: p.stockMinimo || config.stock.minimoAlerta }));

  return {
    periodo: { desde: desde || null, hasta: hasta || null },
    totalVendido, unidadesVendidas, ticketPromedio,
    margenBruto, ranking, sinRotacion, deudores, porAgotarse,
  };
}

// ── GET /api/movimientos (admin) ──────────────────────────────────────────────
app.get("/api/movimientos", requireAdmin, async (req, res) => {
  const movs = await sheets.leerMovimientos();
  if (movs === null) return res.status(502).json({ error: "No se pudo leer Movimientos en Google Sheets." });
  res.json(filtrarMovimientos(movs, req.query));
});

// ── GET /api/metricas (admin) ─────────────────────────────────────────────────
app.get("/api/metricas", requireAdmin, async (req, res) => {
  const movs = await sheets.leerMovimientos();
  if (movs === null) return res.status(502).json({ error: "No se pudo leer Movimientos en Google Sheets." });
  const productos = (await sheets.obtenerProductos()) || config.productosFallback;
  res.json(calcularMetricas(movs, productos, req.query));
});

// ── PATCH /api/movimientos/:id (admin) ────────────────────────────────────────
app.patch("/api/movimientos/:id", requireAdmin, async (req, res) => {
  const { comprador, comentario, cantidad, precio } = req.body || {};
  const campos = {};
  if (comprador  !== undefined) campos.comprador  = comprador;
  if (comentario !== undefined) campos.comentario = comentario;
  if (cantidad   !== undefined) campos.cantidad   = cantidad;
  if (precio     !== undefined) campos.precio     = precio;

  const r = await sheets.actualizarMovimiento(req.params.id, campos);
  if (r === null) return res.status(502).json({ error: "No se pudo actualizar el movimiento en Google Sheets." });
  if (r.error === "not_found") return res.status(404).json({ error: "Movimiento no encontrado." });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

// ── DELETE /api/movimientos/:id (admin) ───────────────────────────────────────
app.delete("/api/movimientos/:id", requireAdmin, async (req, res) => {
  const r = await sheets.borrarMovimiento(req.params.id);
  if (r === null) return res.status(502).json({ error: "No se pudo borrar el movimiento en Google Sheets." });
  if (r.error === "not_found") return res.status(404).json({ error: "Movimiento no encontrado." });
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

// ── POST /api/admin/backfill-ids (admin) ──────────────────────────────────────
// One-shot: genera id (col J) para las filas históricas que no lo tienen, para
// poder editarlas/borrarlas por fila desde el panel.
app.post("/api/admin/backfill-ids", requireAdmin, async (req, res) => {
  const r = await sheets.backfillIds();
  if (r === null) return res.status(502).json({ error: "No se pudo hacer el backfill en Google Sheets." });
  res.json(r);
});

// ── GET /admin ────────────────────────────────────────────────────────────────
// Sirve el panel. (En Vercel, /admin se reescribe a /admin.html vía vercel.json;
// este handler cubre el entorno local.)
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
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

// Helpers puros expuestos para tests (no afectan el handler: module.exports = app)
app._admin = { fechaAISO, filtrarMovimientos, calcularMetricas };

// Handler serverless para Vercel (@vercel/node usa este export por request)
module.exports = app;
