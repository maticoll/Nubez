// ─────────────────────────────────────────────────────────────────────────────
//  api/[...path].js
//  Función serverless catch-all para Vercel (@vercel/node): maneja TODAS las
//  rutas /api/*. Reutiliza el Express app definido en server.js.
//
//  Vercel detecta automáticamente los archivos dentro de /api como funciones,
//  así que /api/productos, /api/pedido y /api/movimiento caen acá. Si por algún
//  motivo Vercel entrega el path sin el prefijo /api, lo reponemos para que las
//  rutas de Express (definidas como /api/...) hagan match igual.
// ─────────────────────────────────────────────────────────────────────────────
const app = require("../server.js");

module.exports = (req, res) => {
  if (req.url && !req.url.startsWith("/api")) {
    req.url = "/api" + (req.url.startsWith("/") ? req.url : "/" + req.url);
  }
  return app(req, res);
};
