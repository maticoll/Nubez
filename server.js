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
const config   = require("./config");
const sheets   = require("./services/sheets");
const telegram = require("./services/telegram");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // Servir frontend

// ── GET /api/productos ────────────────────────────────────────────────────────
// Intenta leer desde Google Sheets; si falla, usa el fallback de config.js
app.get("/api/productos", async (req, res) => {
  let productos = await sheets.obtenerProductos();

  if (!productos) {
    console.warn("[Server] Sheets falló, usando productos de config.js");
    productos = config.productosFallback;
  }

  res.json(productos);
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

  // 1. Registrar en Sheets (packs expandidos en líneas individuales)
  const registrado = await sheets.registrarMovimiento(expandirParaSheets(items));

  // 2. Alerta de nuevo pedido en Telegram
  await telegram.alertaNuevoPedido(items, total);

  // 3. Leer stock actualizado y verificar stock bajo
  const productos = await sheets.obtenerProductos() || config.productosFallback;

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

// ── Iniciar servidor ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`   Google Sheet ID: ${process.env.GOOGLE_SHEET_ID || "⚠️  no configurado"}`);
  console.log(`   Telegram:        ${process.env.TELEGRAM_BOT_TOKEN ? "✅ configurado" : "⚠️  no configurado"}\n`);
});
