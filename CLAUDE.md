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
├── server.js               # Servidor Express + endpoints API
├── config.js               # Config del negocio (precios, productos fallback, umbrales)
├── services/
│   ├── sheets.js           # Lectura de stock y registro de movimientos en Sheets
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
| `PORT` | Puerto del servidor (default: 3000) |

## Endpoints
| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/productos` | Devuelve productos con stock desde Sheets (fallback a config.js) |
| `POST` | `/api/pedido` | Registra pedido en Sheets y envía alertas Telegram |

## Google Sheets – estructura esperada
- **Hoja `Inventario`** (Tabla_2): columnas A=alias, B=sabor, C=stock inicial, D=entradas, E=salidas, F=stock actual (fórmula)
- **Hoja `Movimientos`** (Tabla_1): columnas A=fecha, B=tipo, C=sabor, D=cantidad, E=precio unitario, F=total, G=comprador, H=tipo venta, I=comentario
- El stock se calcula automáticamente via fórmulas SUMIF en Sheets; el backend **no** escribe en la columna de stock directamente.

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

## Convenciones
- Los `alias` en `config.js` deben coincidir **exactamente** (lowercase) con la columna A de la hoja Inventario en Sheets.
- Los precios y productos se mantienen en `config.js` → `productosFallback`. Sheets solo provee el stock en tiempo real.
- Nunca commitear `.env`. Usar `.env.example` si se necesita compartir la estructura.
