// ─────────────────────────────────────────────────────────────────────────────
//  admin.js - Panel de administración Nubez
//  Login por clave (X-Admin-Password en localStorage) + Inventario / Movimientos
//  / Métricas, con acciones por fila (marcar pago / editar / borrar).
// ─────────────────────────────────────────────────────────────────────────────

const PASS_KEY = "nubez_admin_pass";

// Al cambiar la versión del panel forzamos re-login: evita quedar "adentro" con
// una clave vieja y confirma que se cargó la versión nueva (no la cacheada).
const PANEL_VERSION = "3";
if (localStorage.getItem("nubez_panel_v") !== PANEL_VERSION) {
  localStorage.removeItem(PASS_KEY);
  localStorage.setItem("nubez_panel_v", PANEL_VERSION);
}

const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const fmt = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-UY");

// ── Estado ────────────────────────────────────────────────────────────────────
function getPass()  { return localStorage.getItem(PASS_KEY) || ""; }
function setPass(p) { localStorage.setItem(PASS_KEY, p); }
function clearPass(){ localStorage.removeItem(PASS_KEY); }

// ── Fetch helper (mete la clave en cada request) ──────────────────────────────
async function api(path, opts = {}) {
  const headers = Object.assign({ "X-Admin-Password": getPass() }, opts.headers || {});
  if (opts.body && typeof opts.body !== "string") {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    clearPass();
    mostrarLogin("Sesión expirada o clave inválida.");
    throw new Error("401");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, tipo = "") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast" + (tipo ? ` toast--${tipo}` : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

// ── Login ───────────────────────────────────────────────────────────────────
function mostrarLogin(error) {
  $("#app").hidden = true;
  $("#login").hidden = false;
  const err = $("#login-error");
  if (error) { err.textContent = error; err.hidden = false; }
  else err.hidden = true;
  $("#login-pass").focus();
}

function mostrarApp() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  cargarTab("inventario");
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = $("#login-pass").value;
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pass }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      $("#login-error").textContent = d.error || "Clave incorrecta.";
      $("#login-error").hidden = false;
      return;
    }
    setPass(pass);
    mostrarApp();
  } catch (err) {
    $("#login-error").textContent = "No se pudo conectar con el servidor.";
    $("#login-error").hidden = false;
  }
});

$("#logout").addEventListener("click", () => { clearPass(); mostrarLogin(); });

// ── Tabs ──────────────────────────────────────────────────────────────────────
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.remove("is-active"));
  t.classList.add("is-active");
  $$(".view").forEach((v) => v.classList.remove("is-active"));
  $(`#view-${t.dataset.tab}`).classList.add("is-active");
  cargarTab(t.dataset.tab);
}));

$$("[data-refresh]").forEach((b) => b.addEventListener("click", () => cargarTab(b.dataset.refresh)));

function cargarTab(tab) {
  if (tab === "inventario")  return cargarInventario();
  if (tab === "movimientos") return cargarMovimientos();
  if (tab === "metricas")    return cargarMetricas();
}

// ── Inventario ──────────────────────────────────────────────────────────────
async function cargarInventario() {
  const tbody = $("#tbl-inventario tbody");
  tbody.innerHTML = `<tr><td colspan="5" class="empty">Cargando…</td></tr>`;
  try {
    const productos = await api("/api/inventario"); // inventario COMPLETO (sin filtrar por precio)
    if (!productos.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty">Sin productos.</td></tr>`; return; }
    tbody.innerHTML = productos.map((p) => {
      const bajo = typeof p.stock === "number" && p.stock <= (p.stockMinimo || 3);
      return `<tr class="${bajo ? "row-low" : ""}">
        <td>${esc(p.nombre)}</td>
        <td>${esc(p.sabor || "")}</td>
        <td class="num">${fmt(p.precio)}</td>
        <td class="num">${p.stock}</td>
        <td class="num">${p.stockMinimo || 3}</td>
      </tr>`;
    }).join("");
  } catch (err) { tbody.innerHTML = `<tr><td colspan="5" class="empty">${esc(err.message)}</td></tr>`; }
}

// ── Movimientos ─────────────────────────────────────────────────────────────
$("#filtros").addEventListener("submit", (e) => { e.preventDefault(); cargarMovimientos(); });
$("#filtros-reset").addEventListener("click", () => setTimeout(cargarMovimientos, 0));

async function correrBackfill() {
  if (!confirm("Generar id a las filas viejas sin id (solo afecta la columna J)?")) return;
  try {
    const r = await api("/api/admin/backfill-ids", { method: "POST" });
    toast(`Backfill: ${r.generados} fila(s) actualizadas.`, "ok");
    cargarMovimientos();
  } catch (err) { toast(err.message, "error"); }
}
$("#backfill").addEventListener("click", correrBackfill);
$("#banner-backfill-btn").addEventListener("click", correrBackfill);

function queryFiltros() {
  const f = $("#filtros");
  const p = new URLSearchParams();
  ["desde", "hasta", "tipo", "comprador", "estado"].forEach((k) => {
    const v = f.elements[k].value.trim();
    if (v) p.set(k, v);
  });
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

// Cache de la última lista para abrir el modal con los valores actuales
let movCache = [];

async function cargarMovimientos() {
  const tbody = $("#tbl-movimientos tbody");
  tbody.innerHTML = `<tr><td colspan="10" class="empty">Cargando…</td></tr>`;
  try {
    const movs = await api("/api/movimientos" + queryFiltros());
    movCache = movs;
    actualizarBannerBackfill(movs);
    if (!movs.length) { tbody.innerHTML = `<tr><td colspan="10" class="empty">Sin movimientos.</td></tr>`; return; }
    // Las filas se agregan al final de la hoja (cronológico viejo→nuevo). Mostramos
    // del último al primero: invertimos una copia (movCache queda en orden original).
    tbody.innerHTML = movs.slice().reverse().map(renderFila).join("");
    $$("[data-accion]", tbody).forEach((b) => b.addEventListener("click", onAccion));
  } catch (err) { tbody.innerHTML = `<tr><td colspan="10" class="empty">${esc(err.message)}</td></tr>`; }
}

// Muestra el cartel cuando hay filas sin id (no se pueden editar/borrar hasta el backfill)
function actualizarBannerBackfill(movs) {
  const sinId = (movs || []).filter((m) => !m.id).length;
  const banner = $("#banner-backfill");
  if (sinId > 0) {
    $("#banner-backfill-text").textContent =
      `Hay ${sinId} movimiento(s) sin ID (cargados antes de esta función). Generá los IDs para poder editarlos, borrarlos o marcarlos como pago.`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function badgeEstado(c) {
  const v = (c || "").trim().toLowerCase();
  if (v === "debe") return `<span class="badge badge--debe">debe</span>`;
  if (v === "pago") return `<span class="badge badge--pago">pago</span>`;
  return esc(c || "");
}
function badgeTipo(t) {
  return t === "Entrada"
    ? `<span class="badge badge--entrada">Entrada</span>`
    : `<span class="badge badge--salida">Salida</span>`;
}

function renderFila(m) {
  const dataAttr = `data-id="${esc(m.id)}"`;
  const esDebe = (m.comentario || "").trim().toLowerCase() === "debe";
  const pagoBtn = esDebe
    ? `<button class="btn btn--xs btn--primary" data-accion="pago" ${dataAttr}>Pago</button>` : "";
  return `<tr>
    <td>${esc(m.fecha)}</td>
    <td>${badgeTipo(m.tipo)}</td>
    <td>${esc(m.sabor)}</td>
    <td class="num">${m.cantidad}</td>
    <td class="num">${fmt(m.precio)}</td>
    <td class="num">${fmt(m.total)}</td>
    <td>${esc(m.comprador)}</td>
    <td>${esc(m.tipoVenta)}</td>
    <td>${badgeEstado(m.comentario)}</td>
    <td class="actions">
      ${pagoBtn}
      <button class="btn btn--xs btn--ghost" data-accion="editar" ${dataAttr}>Editar</button>
      <button class="btn btn--xs btn--danger" data-accion="borrar" ${dataAttr}>Borrar</button>
    </td>
  </tr>`;
}

async function onAccion(e) {
  const btn = e.currentTarget;
  const id = btn.dataset.id;
  const accion = btn.dataset.accion;

  // Las filas históricas (anteriores a la col J) no tienen id: hay que correr el
  // Backfill una vez para poder editarlas/borrarlas/marcarlas.
  if (!id) {
    toast("Esta fila no tiene id. Tocá «⚙ Backfill ids» una vez y reintentá.", "error");
    return;
  }

  if (accion === "pago") {
    if (!confirm("¿Marcar esta venta como pagada?")) return;
    try {
      await api(`/api/movimientos/${encodeURIComponent(id)}`, { method: "PATCH", body: { comentario: "pago" } });
      toast("Marcado como pago.", "ok");
      cargarMovimientos();
    } catch (err) { toast(err.message, "error"); }
    return;
  }

  if (accion === "borrar") {
    if (!confirm("¿Borrar este movimiento? El stock se recalcula solo.")) return;
    try {
      await api(`/api/movimientos/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("Movimiento borrado.", "ok");
      cargarMovimientos();
    } catch (err) { toast(err.message, "error"); }
    return;
  }

  if (accion === "editar") {
    const mov = movCache.find((m) => String(m.id) === String(id));
    abrirModal(mov || { id });
  }
}

// ── Modal de edición ──────────────────────────────────────────────────────────
function abrirModal(m) {
  const f = $("#edit-form");
  f.elements.id.value = m.id || "";
  f.elements.comprador.value = m.comprador || "";
  f.elements.cantidad.value = m.cantidad != null ? m.cantidad : "";
  f.elements.precio.value = m.precio != null ? m.precio : "";
  f.elements.comentario.value = m.comentario || "";
  $("#modal").hidden = false;
}
function cerrarModal() { $("#modal").hidden = true; }
$("#edit-cancel").addEventListener("click", cerrarModal);
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") cerrarModal(); });

$("#edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  const id = f.elements.id.value;
  const body = {
    comprador:  f.elements.comprador.value,
    comentario: f.elements.comentario.value,
  };
  if (f.elements.cantidad.value !== "") body.cantidad = Number(f.elements.cantidad.value);
  if (f.elements.precio.value   !== "") body.precio   = Number(f.elements.precio.value);
  try {
    await api(`/api/movimientos/${encodeURIComponent(id)}`, { method: "PATCH", body });
    cerrarModal();
    toast("Movimiento actualizado.", "ok");
    cargarMovimientos();
  } catch (err) { toast(err.message, "error"); }
});

// ── Métricas ──────────────────────────────────────────────────────────────────
$("#filtros-met").addEventListener("submit", (e) => { e.preventDefault(); cargarMetricas(); });
$("#filtros-met-reset").addEventListener("click", () => setTimeout(cargarMetricas, 0));

async function cargarMetricas() {
  const cards = $("#met-cards");
  cards.innerHTML = `<div class="empty">Cargando…</div>`;
  const f = $("#filtros-met");
  const p = new URLSearchParams();
  ["desde", "hasta"].forEach((k) => { const v = f.elements[k].value.trim(); if (v) p.set(k, v); });
  const qs = p.toString() ? `?${p.toString()}` : "";
  try {
    const m = await api("/api/metricas" + qs);
    cards.innerHTML = [
      tarjeta("Total vendido", fmt(m.totalVendido)),
      tarjeta("Margen bruto", fmt(m.margenBruto)),
      tarjeta("Ticket promedio", fmt(m.ticketPromedio)),
      tarjeta("Unidades vendidas", m.unidadesVendidas),
    ].join("");

    $("#tbl-ranking tbody").innerHTML = m.ranking.length
      ? m.ranking.map((r) => `<tr><td>${esc(r.sabor)}</td><td class="num">${r.unidades}</td><td class="num">${fmt(r.ingreso)}</td><td class="num">${fmt(r.margen)}</td></tr>`).join("")
      : `<tr><td colspan="4" class="empty">Sin ventas en el período.</td></tr>`;

    $("#list-deudores").innerHTML = m.deudores.length
      ? m.deudores.map((d) => `<li><span>${esc(d.comprador)}</span><span>${fmt(d.total)}</span></li>`).join("")
      : `<li class="empty">Sin deudores. 🎉</li>`;

    $("#list-agotarse").innerHTML = m.porAgotarse.length
      ? m.porAgotarse.map((a) => `<li><span>${esc(a.sabor)}</span><span class="muted">${a.stock} / mín ${a.minimo}</span></li>`).join("")
      : `<li class="empty">Todo con stock.</li>`;

    $("#list-sinrotacion").innerHTML = m.sinRotacion.length
      ? m.sinRotacion.map((s) => `<li><span>${esc(s)}</span></li>`).join("")
      : `<li class="empty">Todo rotó en el período.</li>`;
  } catch (err) { cards.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

function tarjeta(label, value) {
  return `<div class="card"><div class="card__label">${esc(label)}</div><div class="card__value">${value}</div></div>`;
}

// ── Utils ──────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ── Arranque ───────────────────────────────────────────────────────────────────
// Gate real: no alcanza con tener algo en localStorage; validamos la clave
// guardada contra el server antes de mostrar el panel.
async function init() {
  const pass = getPass();
  if (!pass) { mostrarLogin(); return; }
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pass }),
    });
    if (res.ok) { mostrarApp(); return; }
    clearPass();
    const d = await res.json().catch(() => ({}));
    mostrarLogin(res.status === 500 ? (d.error || "Falta configurar ADMIN_PASSWORD en el servidor.") : null);
  } catch {
    mostrarLogin("No se pudo conectar con el servidor.");
  }
}
init();
