# CLAUDE.md – Contexto del proyecto Nubez (Tienda de Vapes)

## Descripción general
Tienda online de vapes (ELF BAR, Lost Mary) con checkout por WhatsApp.
El frontend es estático (HTML/CSS/JS vanilla) servido por Express.
El backend registra pedidos en Google Sheets y envía alertas por Telegram.

## Stack
- **Runtime:** Node.js
- **Framework:** Express 4
- **Frontend:** HTML/CSS/JS vanilla en `/public`
- **Integraciones:** Google Sheets API v4 (googleapis), Telegram Bot API (fetch nativo)
- **Config:** dotenv para variables de entorno

## Estructura de archivos
```
Nubez/
├── server.js               # Servidor Express + endpoints API (exporta `app` para Vercel)
├── api/
│   └── [...path].js        # Función serverless catch-all de Vercel (reusa server.js)
├── config.js               # Fallback de productos/precios + umbrales (el catálogo real vive en Sheets)
├── services/
│   ├── sheets.js           # Catálogo+stock desde Sheets, registro de movimientos, normalizePrivateKey
│   └── telegram.js         # Alertas de stock bajo y nuevos pedidos
├── public/
│   ├── index.html          # Frontend (tienda)
│   ├── css/                # Estilos
│   ├── js/                 # Lógica del frontend
│   └── images/             # Imágenes de productos
├── .env                    # Variables de entorno privadas (NO commitear)
├── .gitignore
└── package.json
```

## Variables de entorno (.env)
| Variable | Descripción |
|---|---|
| `GOOGLE_SHEET_ID` | ID del Google Spreadsheet |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email de la cuenta de servicio |
| `GOOGLE_PRIVATE_KEY` | Clave privada RSA (con `\n` literales) |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID` | Chat ID del destinatario de alertas |
| `NUBEZ_API_KEY` | API key para clientes externos (auth de `POST /api/movimiento`) |
| `PORT` | Puerto del servidor (default: 3000) |

> En producción (Vercel) las env vars se cargan en **Settings → Environment Variables**, no desde `.env`.

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/productos` | Catálogo + stock desde Sheets (solo productos con Precio Venta > 0). Fallback a config.js |
| `POST` | `/api/pedido` | Registra pedido en Sheets y envía alertas Telegram (público, lo usa la tienda) |
| `POST` | `/api/movimiento` | Registra venta/compra de stock. **Protegido**: `Authorization: Bearer ${NUBEZ_API_KEY}` |

## Google Sheets – estructura esperada
- **Hoja `Inventario`** (Tabla_2): A=alias, B=sabor, C=stock inicial, D=entradas, E=salidas, F=stock actual (fórmula), **G=precio compra (costo)**, **H=precio venta (precio de tienda)**, I=inversión total, J=ganancia
- **Hoja `Movimientos`** (Tabla_1): A=fecha, B=tipo (`Entrada`/`Salida`, singular y exacto), C=sabor, D=cantidad, E=precio unitario, F=total, G=comprador, H=tipo venta, I=comentario
- El stock (col F) se calcula con `SUMIFS` de **dos** criterios: tipo (B) **y** sabor (C de Movimientos debe coincidir EXACTO con el Sabor B de Inventario). El backend **no** escribe stock directo.
- **Catálogo sheet-driven:** `obtenerProductos()` arma los productos leyendo la hoja (alias, nombre=Sabor, **precio=col H**, stock=col F). Agregar un producto a la tienda = agregar fila en Inventario + cargar su **Precio Venta (col H)**. `config.js` es fallback por-campo (nombre/precio/imagen de los originales).

## Lógica de pedidos
1. El frontend arma el carrito y hace `POST /api/pedido`
2. El backend expande packs/promos en ítems individuales (`expandirParaSheets`)
3. Inserta filas en Movimientos usando `insertDimension` (para que queden dentro de la tabla y no rompan las fórmulas)
4. Envía alerta de nuevo pedido a Telegram
5. Verifica stock proyectado y envía alerta si queda en 0 o por debajo del mínimo
6. El frontend abre WhatsApp con el resumen del pedido

## Alertas Telegram
- `alertaNuevoPedido`: se dispara en cada pedido iniciado
- `alertaStockBajo`: se dispara si `stock - cantidad_pedida <= stockMinimo` (default 3 por producto o el global de `config.js`)

## Comandos útiles
```bash
npm start       # Producción
npm run dev     # Desarrollo con nodemon (hot reload)
```

## Despliegue (Vercel)
- **Root Directory del proyecto = raíz del repo** (NO `public/`). Si apunta a `public/`, Vercel ignora `server.js`/`api/`/`vercel.json` y sirve solo el estático → todo `/api/*` da 404.
- La API corre como función serverless via `api/[...path].js` (catch-all que reusa el Express `app`). `server.js` hace `module.exports = app` y solo `listen()` en local (`!process.env.VERCEL`).
- `GOOGLE_PRIVATE_KEY`: Vercel a veces guarda el PEM sin saltos de línea. `normalizePrivateKey()` lo reconstruye, así funciona igual.

## Convenciones
- `alias` (col A) = clave de matcheo con `config.js`. `Sabor` (col B) = clave de los SUMIFS de stock: **no renombrar** sin actualizar Movimientos.
- **Catálogo desde la hoja** (sheet-driven): productos, nombre y precio (Precio Venta, col H) salen de Inventario. `config.js` → `productosFallback` es solo fallback (los 11 originales y si Sheets se cae).
- Nunca commitear `.env` (ya está fuera del tracking de git). Usar `.env.example` para compartir la estructura.
