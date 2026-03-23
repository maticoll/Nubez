// ─────────────────────────────────────────────────────────────────────────────
//  services/telegram.js
//  Envía alertas al bot de Telegram cuando el stock está bajo o en cero.
//
//  Para obtener tu TELEGRAM_CHAT_ID:
//    1. Creá un bot con @BotFather en Telegram y copiá el token
//    2. Mandá cualquier mensaje a tu bot
//    3. Entrá a: https://api.telegram.org/bot<TU_TOKEN>/getUpdates
//    4. El chat_id aparece en el resultado
// ─────────────────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

// ── Enviar mensaje por Telegram ───────────────────────────────────────────────
async function enviarMensaje(texto) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn("[Telegram] Token o chat_id no configurados. Saltando alerta.");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    CHAT_ID,
        text:       texto,
        parse_mode: "HTML",
      }),
    });

    const data = await res.json();

    if (data.ok) {
      console.log("[Telegram] Alerta enviada correctamente.");
      return true;
    } else {
      console.error("[Telegram] Error:", data.description);
      return false;
    }
  } catch (err) {
    console.error("[Telegram] Error enviando mensaje:", err.message);
    return false;
  }
}

// ── Alerta de stock bajo ──────────────────────────────────────────────────────
async function alertaStockBajo(producto, stockActual) {
  const emoji   = stockActual === 0 ? "🚨" : "⚠️";
  const estado  = stockActual === 0 ? "SIN STOCK" : "STOCK BAJO";
  const mensaje =
    `${emoji} <b>ALERTA DE INVENTARIO</b>\n\n` +
    `📦 Producto: <b>${producto}</b>\n` +
    `📉 Stock actual: <b>${stockActual} unidades</b>\n` +
    `🔴 Estado: <b>${estado}</b>\n\n` +
    `Revisá tu inventario en Google Sheets.`;

  return enviarMensaje(mensaje);
}

// ── Alerta de nuevo pedido iniciado ──────────────────────────────────────────
async function alertaNuevoPedido(items, total) {
  const lineas  = items.map((i) => `• ${i.nombre} x${i.cantidad} = $${i.precio * i.cantidad}`).join("\n");
  const mensaje =
    `🛒 <b>NUEVO PEDIDO INICIADO</b>\n\n` +
    `${lineas}\n\n` +
    `💰 Total: <b>$${total}</b>\n` +
    `📱 El cliente abrió WhatsApp para confirmar.`;

  return enviarMensaje(mensaje);
}

module.exports = { alertaStockBajo, alertaNuevoPedido };
