// ─────────────────────────────────────────────────────────────────────────────
//  config.js
//  Archivo central de configuración. Editá aquí los valores del negocio.
// ─────────────────────────────────────────────────────────────────────────────

const config = {

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  whatsapp: {
    numero: "59893944122",          // Sin + ni espacios
    saludo: "Hola, me gustaría pedir:",
  },

  // ── Stock ─────────────────────────────────────────────────────────────────
  stock: {
    minimoAlerta: 3,                // Enviar alerta Telegram si stock <= este número
  },

  // ── Google Sheets ─────────────────────────────────────────────────────────
  sheets: {
    hojaProductos:    "Inventario",   // Pestaña de stock (alias en col A, sabor en B, stock actual en F)
    hojaMovimientos:  "Movimientos",  // Pestaña de movimientos (Fecha, Tipo, Sabor, Cantidad, Precio, Total, Comprador, Tipo, Comentario)
  },

  // ── Productos ─────────────────────────────────────────────────────────────
  // Si no usás Google Sheets, podés definir los productos acá como fallback.
  // Cada producto: { id, nombre, descripcion, precio, stock, imagen, stockMinimo }
  // alias: debe coincidir exactamente con la columna A de Tabla_2
  // precio: actualizá según tus precios actuales
  productosFallback: [
    {
      id: 1,
      alias: "sour apple ice",
      nombre: "Sour Apple Ice🍏🍋❄️ ELF 40",
      descripcion: "ELF BAR ICE KING 40000 – 40,000 puffs recargable.",
      precio: 1400,
      stock: 0,
      imagen: "/images/elf40-sour-apple-ice.jpg",
      stockMinimo: 3,
    },
    {
      id: 2,
      alias: "strawberry watermelon",
      nombre: "Strawberry Watermelon 🍓🍉 ELF 40",
      descripcion: "ELF BAR ICE KING 40000 – 40,000 puffs recargable.",
      precio: 1400,
      stock: 0,
      imagen: "/images/elf40-strawberry-watermelon.webp",
      stockMinimo: 3,
    },
    {
      id: 3,
      alias: "peach plus",
      nombre: "Peach Plus🍑✨ ELF 40",
      descripcion: "ELF BAR ICE KING 40000 – 40,000 puffs recargable.",
      precio: 1500,
      stock: 0,
      imagen: "/images/elf40-peach-plus.jpg",
      stockMinimo: 3,
    },
    {
      id: 4,
      alias: "blue razz ice elf",
      nombre: "Blue Razz Ice 🔵🍓❄️ ELF 40",
      descripcion: "ELF BAR ICE KING 40000 – 40,000 puffs recargable.",
      precio: 1500,
      stock: 0,
      imagen: "/images/elf40-blue-razz-ice.jpg",
      stockMinimo: 3,
    },
    {
      id: 5,
      alias: "watermelon ice elf",
      nombre: "Watermelon ice 🍉🧊 ELF 40",
      descripcion: "ELF BAR ICE KING 40000 – 40,000 puffs recargable.",
      precio: 1500,
      stock: 0,
      imagen: "/images/elf40-watermelon-ice.jpg",
      stockMinimo: 3,
    },
    {
      id: 6,
      alias: "cherry strazz",
      nombre: "Cherry Strazz 🍒❄️ ELF 40",
      descripcion: "ELF BAR ICE KING 40000 – 40,000 puffs recargable.",
      precio: 1500,
      stock: 0,
      imagen: "/images/elf40-cherry-strazz.jpg",
      stockMinimo: 3,
    },
    {
      id: 7,
      alias: "watermelon ice dura",
      nombre: "Watermelon Ice 🍉❄️ Dura",
      descripcion: "Lost Mary Dura – Recargable.",
      precio: 1400,
      stock: 0,
      imagen: "/images/dura-watermelon-ice.png",
      stockMinimo: 3,
    },
    {
      id: 8,
      alias: "blue razz ice dura",
      nombre: "Blue Razz Ice 🔵🍓❄️ Dura",
      descripcion: "Lost Mary Dura – Recargable.",
      precio: 1600,
      stock: 0,
      imagen: "/images/dura-blue-razz-ice.png",
      stockMinimo: 3,
    },
    {
      id: 9,
      alias: "strawberry kiwi",
      nombre: "Strawberry Kiwi 🍓🥝 Dura",
      descripcion: "Lost Mary Dura – Recargable.",
      precio: 1500,
      stock: 0,
      imagen: "/images/dura-strawberry-kiwi.webp",
      stockMinimo: 3,
    },
    {
      id: 10,
      alias: "ice mint",
      nombre: "Ice Mint❄️🌿 LM 35k",
      descripcion: "Lost Mary 35K – 35,000 puffs recargable.",
      precio: 1500,
      stock: 0,
      imagen: "/images/lm35k-ice-mint.jpg",
      stockMinimo: 3,
    },
    {
      id: 11,
      alias: "sour grape ice",
      nombre: "Sour Grape Ice🍇🍋❄️ LM 35k",
      descripcion: "Lost Mary 35K – 35,000 puffs recargable.",
      precio: 1500,
      stock: 0,
      imagen: "/images/lm35k-sour-grape-ice.png",
      stockMinimo: 3,
    },
  ],
};

module.exports = config;
