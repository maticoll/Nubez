// ─────────────────────────────────────────────────────────────────────────────
//  app.js - Frontend VapesStore
//  Maneja: catálogo, carrito, WhatsApp y comunicación con el backend.
// ─────────────────────────────────────────────────────────────────────────────

// ── Configuración frontend ────────────────────────────────────────────────────
const CONFIG = {
  whatsappNumero: "59893944122",
  stockMinimoVisible: 2,
};

const PROMOS = [
  { id: "pack-duo",     emoji: "🎯", nombre: "Pack Dúo",     cantidad: 2, precio: 2800 },
  { id: "pack-pro",     emoji: "🚀", nombre: "Pack Pro",     cantidad: 3, precio: 4200 },
  { id: "pack-premium", emoji: "💎", nombre: "Pack Premium", cantidad: 5, precio: 6500 },
];

// ── Estado del carrito ────────────────────────────────────────────────────────
let carrito = [];    // [{ id, nombre, precio, cantidad, stock }]
let catalogoProductos = []; // copia del catálogo para lookup por id

// ── Referencias al DOM ────────────────────────────────────────────────────────
const productosGrid    = document.getElementById("productosGrid");
const carritoPanel     = document.getElementById("carrito");
const carritoItems     = document.getElementById("carritoItems");
const carritoTotal     = document.getElementById("carritoTotal");
const cartBadge        = document.getElementById("cartBadge");
const btnAbrirCarrito  = document.getElementById("btnAbrirCarrito");
const btnCerrarCarrito = document.getElementById("btnCerrarCarrito");
const btnComprar       = document.getElementById("btnComprar");
const overlay          = document.getElementById("overlay");

// ─────────────────────────────────────────────────────────────────────────────
//  CARGA DE PRODUCTOS
// ─────────────────────────────────────────────────────────────────────────────

async function cargarProductos() {
  try {
    const res      = await fetch("/api/productos");
    const productos = await res.json();
    catalogoProductos = productos;
    renderProductos(productos);
  } catch (err) {
    console.error("Error cargando productos:", err);
    productosGrid.innerHTML = `
      <p style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:3rem">
        Error cargando productos. Verificá que el servidor esté corriendo.
      </p>`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERIZADO DE PRODUCTOS
// ─────────────────────────────────────────────────────────────────────────────

function renderProductos(productos) {
  productosGrid.innerHTML = "";

  if (!productos.length) {
    productosGrid.innerHTML = `<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:3rem">Sin productos disponibles.</p>`;
    return;
  }

  productos.forEach((p) => {
    const sinStock  = p.stock <= 0;
    const stockBajo = !sinStock && p.stock <= CONFIG.stockMinimoVisible;

    // Estado de stock para mostrar
    let stockLabel = "";
    if (sinStock)       stockLabel = `<span class="producto-card__stock sin-stock">Sin stock</span>`;
    else if (stockBajo) stockLabel = `<span class="producto-card__stock stock-bajo">⚡ Últimas ${p.stock} unidades</span>`;
    else                stockLabel = "";

    // Imagen o placeholder
    const imgHtml = p.imagen && p.imagen !== "/images/placeholder.jpg"
      ? `<img class="producto-card__img" src="${p.imagen}" alt="${p.nombre}" loading="lazy" />`
      : `<div class="producto-card__img-placeholder"><i class="fa-solid fa-wind"></i></div>`;

    const card = document.createElement("article");
    card.className = "producto-card";
    card.dataset.id = p.id;
    card.innerHTML = `
      ${imgHtml}
      <div class="producto-card__body">
        <h3 class="producto-card__nombre">${p.nombre}</h3>
        <p class="producto-card__desc">${p.descripcion}</p>
        <p class="producto-card__precio">$${p.precio.toLocaleString("es-UY")}</p>
        ${stockLabel}
        <div class="producto-card__controles">
          <button class="qty-btn" data-action="menos" data-id="${p.id}" ${sinStock ? "disabled" : ""}>−</button>
          <input class="qty-input" type="number" min="1" max="${p.stock}" value="1" data-id="${p.id}" ${sinStock ? "disabled" : ""} />
          <button class="qty-btn" data-action="mas" data-id="${p.id}" ${sinStock ? "disabled" : ""}>+</button>
        </div>
        <button
          class="btn btn--agregar"
          data-id="${p.id}"
          data-nombre="${p.nombre}"
          data-precio="${p.precio}"
          data-stock="${p.stock}"
          ${sinStock ? "disabled" : ""}
        >
          ${sinStock ? "Sin stock" : '<i class="fa-solid fa-plus"></i> Agregar al carrito'}
        </button>
      </div>
    `;

    productosGrid.appendChild(card);
  });

  // Eventos de cantidad y agregar
  productosGrid.addEventListener("click", manejarClickProducto);
  productosGrid.addEventListener("change", manejarCambioQty);
}

// ─────────────────────────────────────────────────────────────────────────────
//  MANEJO DE EVENTOS EN CATÁLOGO
// ─────────────────────────────────────────────────────────────────────────────

function manejarClickProducto(e) {
  // Botón + o -
  const qtyBtn = e.target.closest(".qty-btn");
  if (qtyBtn) {
    const id     = qtyBtn.dataset.id;
    const input  = productosGrid.querySelector(`.qty-input[data-id="${id}"]`);
    const max    = parseInt(input.max);
    let val      = parseInt(input.value) || 1;

    if (qtyBtn.dataset.action === "mas")  val = Math.min(val + 1, max);
    if (qtyBtn.dataset.action === "menos") val = Math.max(val - 1, 1);

    input.value = val;
    return;
  }

  // Botón agregar
  const btnAgregar = e.target.closest(".btn--agregar");
  if (btnAgregar) {
    const id      = parseInt(btnAgregar.dataset.id);
    const precio  = parseFloat(btnAgregar.dataset.precio);
    const stock   = parseInt(btnAgregar.dataset.stock);
    const input   = productosGrid.querySelector(`.qty-input[data-id="${id}"]`);
    const qty     = parseInt(input.value) || 1;
    // Leer el nombre desde el catálogo (evita que emojis se escapen en atributos HTML)
    const prod    = catalogoProductos.find((p) => p.id === id);
    const nombre  = prod ? prod.nombre : btnAgregar.dataset.nombre;

    agregarAlCarrito({ id, nombre, precio, stock, cantidad: qty });
    input.value = 1;
  }
}

function manejarCambioQty(e) {
  if (!e.target.classList.contains("qty-input")) return;
  const max = parseInt(e.target.max);
  const min = 1;
  let val   = parseInt(e.target.value);
  if (isNaN(val) || val < min) e.target.value = min;
  if (val > max)               e.target.value = max;
}

// ─────────────────────────────────────────────────────────────────────────────
//  LÓGICA DEL CARRITO
// ─────────────────────────────────────────────────────────────────────────────

function agregarAlCarrito(producto) {
  const existente = carrito.find((i) => i.id === producto.id);

  if (existente) {
    const nuevaCantidad = existente.cantidad + producto.cantidad;
    if (nuevaCantidad > existente.stock) {
      mostrarToast(`Solo hay ${existente.stock} unidades disponibles.`);
      return;
    }
    existente.cantidad = nuevaCantidad;
  } else {
    carrito.push({ ...producto });
  }

  renderCarrito();
  abrirCarrito();
  mostrarToast(`${producto.nombre} agregado ✓`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  DESCUENTO AUTOMÁTICO POR PACKS
// ─────────────────────────────────────────────────────────────────────────────

const PACK_AUTO = [
  { size: 5, precio: 6500, id: "pack-auto-premium", emoji: "💎", nombre: "Pack Premium" },
  { size: 3, precio: 4200, id: "pack-auto-pro",     emoji: "🚀", nombre: "Pack Pro"     },
  { size: 2, precio: 2800, id: "pack-auto-duo",     emoji: "🎯", nombre: "Pack Dúo"     },
];

function calcularDescuento() {
  // Solo items individuales (no promos ya elegidas)
  const individuales = carrito.filter((i) => !i.esPromo);

  // Expandir a unidades ordenadas por precio desc (maximiza ahorro)
  const unidades = [];
  for (const item of individuales) {
    for (let k = 0; k < item.cantidad; k++) {
      unidades.push({ precio: item.precio, nombre: item.nombre, itemId: item.id });
    }
  }
  unidades.sort((a, b) => b.precio - a.precio);

  const n = unidades.length;
  if (n < 2) return { descuento: 0, itemsAjustados: null };

  // DP: dp[i] = mínimo costo para las primeras i unidades
  const dp   = new Array(n + 1).fill(Infinity);
  const from = new Array(n + 1).fill(null);
  dp[0] = 0;

  for (let i = 1; i <= n; i++) {
    // Precio individual
    const costoIndiv = dp[i - 1] + unidades[i - 1].precio;
    if (costoIndiv < dp[i]) {
      dp[i]   = costoIndiv;
      from[i] = { size: 1 };
    }
    // Packs
    for (const pack of PACK_AUTO) {
      if (i >= pack.size) {
        const costoPack = dp[i - pack.size] + pack.precio;
        if (costoPack < dp[i]) {
          dp[i]   = costoPack;
          from[i] = { size: pack.size, pack };
        }
      }
    }
  }

  const totalOriginal = unidades.reduce((s, u) => s + u.precio, 0);
  const descuento = totalOriginal - dp[n];
  if (descuento <= 0) return { descuento: 0, itemsAjustados: null };

  // Traceback: armar grupos (packs y sueltos)
  const grupos = [];
  let i = n;
  while (i > 0) {
    const f = from[i];
    if (f.size === 1) {
      grupos.push({ type: "individual", unit: unidades[i - 1] });
      i -= 1;
    } else {
      grupos.push({ type: "pack", pack: f.pack, units: unidades.slice(i - f.size, i) });
      i -= f.size;
    }
  }

  // Construir itemsAjustados para el backend
  const itemsAjustados = [...carrito.filter((i) => i.esPromo)];

  // Reagrupar individuales que no entraron en pack
  const solosMap = {};
  for (const g of grupos) {
    if (g.type === "individual") {
      const orig = carrito.find((item) => item.id === g.unit.itemId);
      if (!solosMap[g.unit.itemId]) solosMap[g.unit.itemId] = { ...orig, cantidad: 0 };
      solosMap[g.unit.itemId].cantidad++;
    } else {
      itemsAjustados.push({
        id:       g.pack.id,
        nombre:   `${g.pack.emoji} ${g.pack.nombre} (auto)`,
        precio:   g.pack.precio,
        stock:    999,
        cantidad: 1,
        sabores:  g.units.map((u) => u.nombre),
        esPromo:  true,
      });
    }
  }
  for (const item of Object.values(solosMap)) {
    if (item.cantidad > 0) itemsAjustados.push(item);
  }

  return { descuento, itemsAjustados };
}

function renderCarrito() {
  // Badge
  const totalItems = carrito.reduce((s, i) => s + i.cantidad, 0);
  cartBadge.textContent = totalItems;
  cartBadge.dataset.count = totalItems;

  // Lista
  if (carrito.length === 0) {
    carritoItems.innerHTML = `<p class="carrito__vacio">Todavía no agregaste productos.</p>`;
    carritoTotal.textContent = "$0";
    document.getElementById("carritoDescuento").style.display = "none";
    btnComprar.disabled = true;
    return;
  }

  carritoItems.innerHTML = carrito.map((item) => {
    const saboresHtml = item.sabores?.length
      ? `<div class="carrito-item__sabores">${item.sabores.map((s) => `· ${s}`).join("<br>")}</div>`
      : "";
    const controlesCantidad = item.esPromo
      ? `<span class="carrito-item__qty">${item.cantidad}</span>`
      : `<button class="carrito-item__qty-btn" data-action="menos" data-id="${item.id}">−</button>
         <span class="carrito-item__qty">${item.cantidad}</span>
         <button class="carrito-item__qty-btn" data-action="mas" data-id="${item.id}">+</button>
         <span style="color:var(--text-muted);font-size:0.8rem">× $${item.precio.toLocaleString("es-UY")}</span>`;
    return `
      <div class="carrito-item" data-id="${item.id}">
        <span class="carrito-item__nombre">${item.nombre}</span>
        <span class="carrito-item__subtotal">$${(item.precio * item.cantidad).toLocaleString("es-UY")}</span>
        <div class="carrito-item__controles">
          ${controlesCantidad}
          <button class="carrito-item__eliminar" data-id="${item.id}" title="Eliminar">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
        ${saboresHtml}
      </div>`;
  }).join("");

  // Total + descuento
  const total = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const { descuento } = calcularDescuento();
  const descuentoEl = document.getElementById("carritoDescuento");

  if (descuento > 0) {
    descuentoEl.style.display = "flex";
    descuentoEl.innerHTML = `<span>🏷️ Descuento packs</span><strong>-$${descuento.toLocaleString("es-UY")}</strong>`;
    carritoTotal.textContent = `$${(total - descuento).toLocaleString("es-UY")}`;
  } else {
    descuentoEl.style.display = "none";
    carritoTotal.textContent = `$${total.toLocaleString("es-UY")}`;
  }
  btnComprar.disabled = false;
}

// Eventos dentro del carrito (delegación)
carritoItems.addEventListener("click", (e) => {
  const btn = e.target.closest(".carrito-item__qty-btn");
  if (btn) {
    const id   = parseInt(btn.dataset.id);
    const item = carrito.find((i) => i.id === id);
    if (!item) return;

    if (btn.dataset.action === "mas") {
      if (item.cantidad < item.stock) item.cantidad++;
      else mostrarToast("No hay más stock disponible.");
    }
    if (btn.dataset.action === "menos") {
      if (item.cantidad > 1) item.cantidad--;
      else eliminarDelCarrito(id);
    }
    renderCarrito();
    return;
  }

  const btnEliminar = e.target.closest(".carrito-item__eliminar");
  if (btnEliminar) {
    eliminarDelCarrito(parseInt(btnEliminar.dataset.id));
  }
});

function eliminarDelCarrito(id) {
  carrito = carrito.filter((i) => i.id !== id);
  renderCarrito();
}

// ─────────────────────────────────────────────────────────────────────────────
//  COMPRA POR WHATSAPP
// ─────────────────────────────────────────────────────────────────────────────

btnComprar.addEventListener("click", async () => {
  if (carrito.length === 0) return;

  const totalBruto = carrito.reduce((s, i) => s + i.precio * i.cantidad, 0);
  const { descuento, itemsAjustados } = calcularDescuento();
  const total = totalBruto - descuento;
  const itemsParaBackend = itemsAjustados || carrito;

  // Armar mensaje de WhatsApp (usando carrito original para que sea legible)
  const lineas = carrito.map((i) => {
    const base = `• ${i.nombre} x${i.cantidad} = $${(i.precio * i.cantidad).toLocaleString("es-UY")}`;
    if (i.sabores?.length) return base + "\n" + i.sabores.map((s) => `   - ${s}`).join("\n");
    return base;
  }).join("\n");

  const descuentoLinea = descuento > 0
    ? `\n🏷️ Descuento packs: -$${descuento.toLocaleString("es-UY")}` : "";

  const mensaje =
    `Hola, me gustaría pedir:\n\n` +
    `${lineas}${descuentoLinea}\n\n` +
    `💰 Total: $${total.toLocaleString("es-UY")}`;

  const urlWA = `https://wa.me/${CONFIG.whatsappNumero}?text=${encodeURIComponent(mensaje)}`;

  // Registrar pedido en el backend (Sheets + Telegram)
  try {
    await fetch("/api/pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: itemsParaBackend }),
    });
  } catch (err) {
    console.warn("No se pudo registrar el pedido en el servidor:", err.message);
  }

  // Abrir WhatsApp
  window.open(urlWA, "_blank");
});

// ─────────────────────────────────────────────────────────────────────────────
//  PANEL DE CARRITO (abrir/cerrar)
// ─────────────────────────────────────────────────────────────────────────────

function abrirCarrito() {
  carritoPanel.classList.add("abierto");
  overlay.classList.add("activo");
  carritoPanel.setAttribute("aria-hidden", "false");
}
function cerrarCarrito() {
  carritoPanel.classList.remove("abierto");
  overlay.classList.remove("activo");
  carritoPanel.setAttribute("aria-hidden", "true");
}

btnAbrirCarrito.addEventListener("click", abrirCarrito);
btnCerrarCarrito.addEventListener("click", cerrarCarrito);
overlay.addEventListener("click", cerrarCarrito);

// ─────────────────────────────────────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────────────────────────────────────

function mostrarToast(mensaje) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = mensaje;
  toast.classList.add("visible");
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove("visible"), 2500);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PROMOS
// ─────────────────────────────────────────────────────────────────────────────

const promoModal       = document.getElementById("promoModal");
const promoModalTitulo = document.getElementById("promoModalTitulo");
const promoModalLista  = document.getElementById("promoModalLista");
const promoSelCount    = document.getElementById("promoSelCount");
const promoSelTotal    = document.getElementById("promoSelTotal");
const btnAgregarPack   = document.getElementById("btnAgregarPack");
const btnCerrarPromoModal = document.getElementById("btnCerrarPromoModal");

let promoActiva   = null;  // promo seleccionada
let promoContadores = {};  // { productoId: cantidad }

function abrirPromoModal(packId) {
  promoActiva    = PROMOS.find((p) => p.id === packId);
  promoContadores = {};

  promoModalTitulo.textContent = `${promoActiva.emoji} ${promoActiva.nombre} — Elegí ${promoActiva.cantidad} sabores`;
  promoSelTotal.textContent    = promoActiva.cantidad;
  promoSelCount.textContent    = "0";
  btnAgregarPack.disabled      = true;
  btnAgregarPack.textContent   = `Agregar pack al carrito — $${promoActiva.precio.toLocaleString("es-UY")}`;

  // Renderizar lista de sabores disponibles
  promoModalLista.innerHTML = catalogoProductos.map((p) => {
    const sinStock = p.stock <= 0;
    return `
      <div class="promo-sabor${sinStock ? " sin-stock" : ""}" data-id="${p.id}">
        <span class="promo-sabor__nombre">${p.nombre}${sinStock ? " — Sin stock" : ""}</span>
        <div class="promo-sabor__controles">
          <button class="promo-sabor__btn" data-action="menos" data-id="${p.id}" disabled>−</button>
          <span class="promo-sabor__qty" id="promoQty-${p.id}">0</span>
          <button class="promo-sabor__btn" data-action="mas" data-id="${p.id}" ${sinStock ? "disabled" : ""}>+</button>
        </div>
      </div>`;
  }).join("");

  promoModal.classList.add("abierto");
  promoModal.setAttribute("aria-hidden", "false");
}

function cerrarPromoModal() {
  promoModal.classList.remove("abierto");
  promoModal.setAttribute("aria-hidden", "true");
  promoActiva = null;
}

function actualizarContadorPromo() {
  const total = Object.values(promoContadores).reduce((s, v) => s + v, 0);
  promoSelCount.textContent = total;
  btnAgregarPack.disabled   = total !== promoActiva.cantidad;

  // Deshabilitar botón "+" si ya se alcanzó el máximo del pack
  const maxAlcanzado = total >= promoActiva.cantidad;
  promoModalLista.querySelectorAll(".promo-sabor__btn[data-action='mas']").forEach((btn) => {
    const id  = parseInt(btn.dataset.id);
    const prod = catalogoProductos.find((p) => p.id === id);
    const qty  = promoContadores[id] || 0;
    btn.disabled = maxAlcanzado && qty === 0 || prod?.stock <= 0;
  });
}

promoModalLista.addEventListener("click", (e) => {
  const btn = e.target.closest(".promo-sabor__btn");
  if (!btn || btn.disabled) return;

  const id  = parseInt(btn.dataset.id);
  const qty = promoContadores[id] || 0;

  if (btn.dataset.action === "mas") {
    promoContadores[id] = qty + 1;
  } else if (btn.dataset.action === "menos" && qty > 0) {
    promoContadores[id] = qty - 1;
    if (promoContadores[id] === 0) delete promoContadores[id];
  }

  // Actualizar qty mostrado y botón menos
  const qtySpan = document.getElementById(`promoQty-${id}`);
  const menosBtn = promoModalLista.querySelector(`.promo-sabor__btn[data-action='menos'][data-id='${id}']`);
  qtySpan.textContent  = promoContadores[id] || 0;
  menosBtn.disabled    = !promoContadores[id];
  actualizarContadorPromo();
});

btnAgregarPack.addEventListener("click", () => {
  if (!promoActiva || btnAgregarPack.disabled) return;

  // Armar lista de sabores seleccionados
  const sabores = [];
  for (const [idStr, qty] of Object.entries(promoContadores)) {
    const prod = catalogoProductos.find((p) => p.id === parseInt(idStr));
    if (prod) for (let i = 0; i < qty; i++) sabores.push(prod.nombre);
  }

  agregarAlCarrito({
    id:       promoActiva.id,
    nombre:   `${promoActiva.emoji} ${promoActiva.nombre}`,
    precio:   promoActiva.precio,
    stock:    999,
    cantidad: 1,
    sabores,
    esPromo:  true,
  });

  cerrarPromoModal();
});

btnCerrarPromoModal.addEventListener("click", cerrarPromoModal);
promoModal.addEventListener("click", (e) => { if (e.target === promoModal) cerrarPromoModal(); });

// Botones "Armar pack" en las tarjetas
document.querySelectorAll(".btn--promo").forEach((btn) => {
  btn.addEventListener("click", () => abrirPromoModal(btn.dataset.pack));
});

// ─────────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────────

cargarProductos();
