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
      range: `${config.sheets.hojaProductos}!A:H`,
    });

    const filas = res.data.values || [];
    const productos = [];

    let auto = 0;
    for (const fila of filas) {
      const alias       = (fila[0] || "").toString().trim().toLowerCase();
      const sabor       = fila[1] != null ? fila[1].toString() : "";
      const stockActual = parseFloat(fila[5]);

      // Saltear cabeceras, separadores, TOTAL y filas sin alias o stock válido
      if (!alias || isNaN(stockActual)) continue;

      // Catálogo armado DESDE LA HOJA (G=precio, H=imagen URL). config.js queda
      // como fallback por-campo (matcheado por alias) para los productos que ya
      // estaban cargados, así no hay que volver a tipear precio/imagen de los 11.
      const base        = config.productosFallback.find(p => p.alias === alias);
      // Precio de la tienda = col H "Precio Venta" (col G es "Precio Compra"/costo).
      const precioVenta = parseInt((fila[7] != null ? fila[7].toString() : "").replace(/[^\d]/g, ""), 10);
      auto++;

      productos.push({
        id:          base ? base.id : 1000 + auto,
        alias,
        nombre:      (base && base.nombre) || sabor || alias,
        descripcion: (base && base.descripcion) || "",
        precio:      Number.isFinite(precioVenta) ? precioVenta : (base ? base.precio : 0),
        stock:       stockActual,
        imagen:      (base && base.imagen) || "",   // sin columna de imagen: config o placeholder
        stockMinimo: (base && base.stockMinimo) || config.stock.minimoAlerta,
        sabor,   // clave EXACTA de los SUMIFS de Inventario (col B)
      });
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

// ── Marcar deudas como pagas ──────────────────────────────────────────────────
// Helper puro (testeable sin red): devuelve los números de fila (base-1) de
// Movimientos que son Salida, del comprador dado (case-insensitive, trim) y con
// comentario "debe".
function _filasPagoAMarcar(filas, comprador) {
  const objetivo = (comprador || "").toString().trim().toLowerCase();
  const rows = [];
  if (!objetivo) return rows;
  for (let i = 0; i < filas.length; i++) {
    const fila   = filas[i] || [];
    const tipo   = (fila[1] != null ? fila[1].toString() : "").trim().toLowerCase();
    const comp   = (fila[6] != null ? fila[6].toString() : "").trim().toLowerCase();
    const coment = (fila[8] != null ? fila[8].toString() : "").trim().toLowerCase();
    if (tipo === "salida" && comp === objetivo && coment === "debe") {
      rows.push(i + 1); // fila de la hoja (base-1)
    }
  }
  return rows;
}

// Busca las ventas "debe" del comprador y les pone comentario "pago" (col I).
// Devuelve cuántas filas se actualizaron, o null si hubo error.
async function marcarPago(comprador) {
  try {
    const auth      = getAuth();
    const sheetsApi = google.sheets({ version: "v4", auth });
    const hoja      = config.sheets.hojaMovimientos;

    const res   = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${hoja}!A:I`,
    });
    const rows = _filasPagoAMarcar(res.data.values || [], comprador);
    if (rows.length === 0) return 0;

    await sheetsApi.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      resource: {
        valueInputOption: "RAW",
        data: rows.map((r) => ({ range: `${hoja}!I${r}`, values: [["pago"]] })),
      },
    });

    console.log(`[Sheets] ${rows.length} deuda(s) marcadas como pagas para "${comprador}".`);
    return rows.length;
  } catch (err) {
    console.error("[Sheets] Error marcando pago:", err.message);
    return null;
  }
}

// ── Actualizar stock ──────────────────────────────────────────────────────────
// No es necesario: Tabla_2 calcula el stock via fórmulas basadas en Tabla_1.
// Esta función se mantiene por compatibilidad con server.js.
async function actualizarStock() {
  return true;
}

module.exports = { obtenerProductos, registrarMovimiento, actualizarStock, normalizePrivateKey, marcarPago, _filasPagoAMarcar };
