# Spec — Panel de administración (Nubez)

> Objetivo: una página `/admin` en la web que muestre **Inventario + Movimientos**
> (espejo del spreadsheet) **y métricas** del negocio, con **acciones** (marcar
> pago, editar, borrar movimientos) y protegida con **clave simple**.
>
> Google Sheets sigue siendo la **fuente de verdad**. La página lee y escribe vía
> API; el stock se sigue calculando con las fórmulas SUMIFS del Inventario.
> Todo es trabajo de Nubez (frontend + endpoints). HERMES no se toca.

---

## Decisiones tomadas
- **Alcance:** espejo (Inventario + Movimientos) **+ métricas** (= incluye la Fase 2).
- **Edición:** lectura **+ acciones** (marcar pago, editar y borrar movimientos).
- **Acceso:** **clave simple** (password/PIN al entrar a `/admin`).

---

## 1. Cambio de datos: columna `id` estable en Movimientos

Para poder editar/borrar una fila puntual sin depender del número de fila (que se
corre al insertar/borrar), agregar una **columna `id`** en la hoja `Movimientos`
(p. ej. **col J**) con un identificador único generado al insertar.

- En `services/sheets.js` → `registrarMovimiento`: generar `id = Date.now().toString(36) + random` y escribirlo en la col J de cada fila nueva. Pasar de escribir `A:I` (9 cols) a `A:J` (10 cols).
- Hacer lo mismo en el flujo de `/api/pedido` (web) para consistencia.
- Las fórmulas SUMIFS del Inventario referencian B/C/D → **no se ven afectadas** por la col J.

> Alternativa sin columna nueva: identificar por número de fila leído al momento
> (optimista). Más frágil ante concurrencia. **Recomendado: columna id.**

---

## 2. Autenticación (clave simple)

- Env var nueva: `ADMIN_PASSWORD`.
- `POST /api/admin/login` `{ password }` → valida contra `ADMIN_PASSWORD` (comparación de tiempo constante) → responde `{ ok: true }`. (Opcional: devolver un token firmado; para uso personal alcanza con reusar la password.)
- Los endpoints de admin (lectura de movimientos, métricas, edición, borrado) exigen la password en header `X-Admin-Password` (o cookie de sesión). El front la guarda en `localStorage` tras el login y la manda en cada request.
- `GET /api/productos` puede seguir público (lo usa la tienda).
- Nota: el firewall ya tiene Bypass para `/api/*`, así que estos endpoints responden a requests no-navegador sin el Security Checkpoint.

---

## 3. Endpoints

### Lectura
- `GET /api/productos` — **ya existe** (Inventario: alias, nombre, stock, precio, stockMinimo).
- `GET /api/movimientos` (admin) — lee la hoja `Movimientos` completa y devuelve filas tipadas:
  ```json
  [{ "id":"...", "fecha":"...", "tipo":"Salida"|"Entrada", "sabor":"...",
     "cantidad":2, "precio":1500, "total":3000, "comprador":"Juan",
     "tipoVenta":"Venta directa", "comentario":"debe" }]
  ```
  Query opcional: `?desde=YYYY-MM-DD&hasta=YYYY-MM-DD`, `?tipo=`, `?comprador=`, `?estado=debe`.

### Métricas
- `GET /api/metricas` (admin) — agrega sobre `Movimientos` (con `?desde&hasta` opcional):
  ```json
  {
    "periodo": { "desde":"...", "hasta":"..." },
    "totalVendido": 45000,
    "unidadesVendidas": 30,
    "ticketPromedio": 1500,
    "margenBruto": 18000,
    "ranking": [ { "sabor":"Ice Mint", "unidades":12, "ingreso":18000, "margen":7200 } ],
    "sinRotacion": ["Cherry Strazz"],
    "deudores": [ { "comprador":"Juan", "total":2800 } ],
    "porAgotarse": [ { "sabor":"Mountain berry", "stock":2, "minimo":3 } ]
  }
  ```
  - **Total vendido / unidades / ticket:** sobre filas `Salida`.
  - **Margen bruto:** ingresos de ventas − costo. Costo unitario por producto = promedio del `precio` de las filas `Entrada` de ese sabor; COGS = costoUnit × unidades vendidas. Margen global y por producto en el ranking.
  - **Deudores:** filas `Salida` con `comentario="debe"`, agrupadas por `comprador`, sumando `total`.
  - **Por agotarse:** del Inventario, `stock <= stockMinimo`.

### Acciones (escritura por fila)
- `PATCH /api/movimientos/:id` (admin) `{ comprador?, comentario?, cantidad?, precio? }` → busca la fila por `id` (col J) y actualiza las celdas dadas. Recalcula `total` si cambia cantidad/precio. El stock se recalcula solo por las fórmulas.
- `DELETE /api/movimientos/:id` (admin) → borra la fila por `id` (usar `deleteDimension` para que las fórmulas sigan bien).
- Atajo útil: `POST /api/marcar-pago` **ya existe** (por comprador). El PATCH cubre el caso por fila.

---

## 4. Frontend `/admin`

- Servir `public/admin.html` (+ su JS/CSS). Gate de login: si no hay password válida en `localStorage`, mostrar form de clave → `POST /api/admin/login`.
- Tres vistas/tabs:
  1. **Inventario** — tabla de productos con stock; resaltar bajo/agotado (`stock <= stockMinimo`).
  2. **Movimientos** — tabla desde `GET /api/movimientos`, con filtros (fecha, tipo, comprador, estado). Por fila: botón **marcar pago** (PATCH comentario→"pago"), **editar** (comprador/cantidad/precio), **borrar** (DELETE).
  3. **Métricas** — tarjetas (total vendido, margen, ticket, unidades) + ranking más/menos vendido + lista de **deudores** + **por agotarse**. Filtro por período. (Opcional: gráfico simple.)
- Reusar estilos del front actual de la tienda.

---

## 5. Orden sugerido de implementación
1. Columna `id` en Movimientos + escribirla en `registrarMovimiento` y `/api/pedido`.
2. Auth (`ADMIN_PASSWORD` + `/api/admin/login` + middleware de header).
3. `GET /api/movimientos` + `GET /api/metricas` (lectura/agregación).
4. Frontend `/admin` read-only (Inventario, Movimientos, Métricas).
5. Acciones: `PATCH` / `DELETE /api/movimientos/:id` + botones en la tabla.

## Verificación
- Login: clave incorrecta → rechazo; correcta → entra.
- Movimientos: la tabla coincide con la hoja; filtros andan.
- Métricas: cuadrar a mano con datos de prueba (sobre todo margen y deudores).
- PATCH/DELETE: cambia/borra la fila correcta (por id) y el stock recalcula.
