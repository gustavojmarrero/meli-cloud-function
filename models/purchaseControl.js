// models/purchaseControl.js
const db = require('../config/mongoDbConfig');
const { Schema } = require('mongoose');

const purchaseControlSchema = new Schema({
    fecha: { type: Date, required: true },
    proveedor: String,
    pedido: String,
    estado: String,
    asin: String,
    titulo: String,
    cantidad: Number,
    sku: String,
    pLista: Number,
    descuento: Number,
    pDdescuento: Number, // Precio con descuento (con IVA)
    acum: Number,
    costoOc: Number,
    costoManual: Number,
    validacion: Boolean,
    envio: Number,
    destino: String,
    marketplace: String,
    plan: String,
    facturado: Boolean,
    recibido: Boolean
}, {
    collection: 'controlDeCompras_d'
});

module.exports = db.model('controlDeCompras_d', purchaseControlSchema);
