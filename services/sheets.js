// ─────────────────────────────────────────────────────────────────────────────
//  services/sheets.js
//  Integración con Google Sheets usando la API de Google.
//
//  Estructura de Tabla_2 (stock):
//    A: alias | B: sabor | C: stock inicial | D: entradas | E: salidas | F: stock actual
//
//  Estructura de Tabla_1 (movimientos):
//    A: fecha | B: tipo | C: sabor | D: cantidad | E: precio unitario | F: total
//    G: comprador | H: tipo venta | I: comentario
// ─────────────────────────────────────────────────────────────────────────────

const { google } = require("googleapis");
const config     = require("../config");

// Normaliza el PEM de la private key. Tolera: \n literales (formato .env),
// saltos de línea reales, comillas envolventes, y el caso "todo en una línea"
// (Vercel a veces come los saltos al guardar la env var) reconstruyendo el PEM
// a partir del base64. Así no hay que pelear con el formato al pegarla.
function normalizePrivateKey(raw) {
  let k = (raw || "").trim();
  if (k.startsWith('"') && k.endsWith('"')) k = k.slice(1, -1); // sacar comillas
  k = k.replace(/\\n/g, "\n");                                   // \n literal -> salto real
  if (/-----BEGIN [^-]+-----\r?\n/.test(k)) return k;            // ya tiene saltos: OK
  // Caso sin saltos: reconstruir el PEM partiendo la base64 en líneas de 64
  const m = k.match(/-----BEGIN ([A-Z0-9 ]+)-----\s*([\s\S]*?)\s*-----END \1-----/);
  if (m) {
    const body = m[2].replace(/\s+/g, "").match(/.{1,64}/g);
    if (body) return `-----BEGIN ${m[1].trim()}-----\n${body.join("\n")}\n-----END ${m[1].trim()}-----\n`;
  }
  return k;
}

function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// ── Leer productos desde Tabla_2 ──────────────────────────────────────────────
// Lee alias (A) y stock actual (F), y fusiona con los datos de config.js
async function obtenerProductos() {
  try {
    const auth   = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${config.sheets.hojaProductos}!A:F`,
    });

    const filas = res.data.values || [];
    const productos = [];

    for (const fila of filas) {
      const alias      = (fila[0] || "").toString().trim().toLowerCase();
      const sabor      = fila[1] != null ? fila[1].toString() : "";
      const stockActual = parseFloat(fila[5]);

      // Saltear filas sin alias o sin stock válido
      if (!alias || isNaN(stockActual)) continue;

      // Buscar el producto en config.js por alias
      const base = config.productosFallback.find(p => p.alias === alias);
      if (!base) continue;

      // sabor = texto EXACTO de la col B; es la clave que usan los SUMIFS de Inventario
      productos.push({ ...base, stock: stockActual, sabor });
    }

    return productos.length > 0 ? productos : null;
  } catch (err) {
    console.error("[Sheets] Error leyendo productos:", err.message);
    return null;
  }
}

// ── Registrar movimiento dentro de la tabla ───────────────────────────────────
// Inserta filas dentro del rango de la tabla usando insertDimension,
// para que queden dentro de la tabla y las fórmulas SUMIF sigan funcionando.
async function registrarMovimiento(items, opts = {}) {
  try {
    // Defaults = comportamiento actual de /api/pedido (no cambia si no se pasan opts)
    const {
      tipo       = "Salida",
      comprador  = "web/whatsapp",
      tipoVenta  = "Venta a cliente",
      comentario = "",
    } = opts;

    const auth      = getAuth();
    const sheetsApi = google.sheets({ version: "v4", auth });

    const fecha = new Date().toLocaleString("es-UY", { timeZone: "America/Montevideo" });

    // 1. Obtener el sheetId numérico de la pestaña Movimientos
    const meta = await sheetsApi.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: "sheets.properties",
    });
    const sheet = meta.data.sheets.find(
      (s) => s.properties.title === config.sheets.hojaMovimientos
    );
    if (!sheet) throw new Error(`Pestaña "${config.sheets.hojaMovimientos}" no encontrada`);
    const sheetId = sheet.properties.sheetId;

    // 2. Encontrar la última fila con datos (para insertar justo ahí, dentro de la tabla)
    const lectura = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${config.sheets.hojaMovimientos}!A:A`,
    });
    const lastRow = (lectura.data.values || []).length; // índice base-1

    // 3. Insertar N filas dentro de la tabla (inheritFromBefore hereda el formato/tabla)
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      resource: {
        requests: [{
          insertDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: lastRow,                   // base-0
              endIndex:   lastRow + items.length,
            },
            inheritFromBefore: true,
          },
        }],
      },
    });

    // 4. Escribir los datos en las filas recién insertadas
    const filas = items.map((item) => [
      fecha,
      tipo,
      item.nombre,
      item.cantidad,
      item.precio,
      item.precio * item.cantidad,
      comprador,
      tipoVenta,
      comentario,
    ]);

    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${config.sheets.hojaMovimientos}!A${lastRow + 1}`,
      valueInputOption: "USER_ENTERED",
      resource: { values: filas },
    });

    console.log(`[Sheets] ${filas.length} movimiento(s) registrado(s) dentro de la tabla.`);
    return true;
  } catch (err) {
    console.error("[Sheets] Error registrando movimiento:", err.message);
    return false;
  }
}

// ── Actualizar stock ──────────────────────────────────────────────────────────
// No es necesario: Tabla_2 calcula el stock via fórmulas basadas en Tabla_1.
// Esta función se mantiene por compatibilidad con server.js.
async function actualizarStock() {
  return true;
}

module.exports = { obtenerProductos, registrarMovimiento, actualizarStock, normalizePrivateKey };
