// models/product.js
const db = require('../config/mongoDbConfig');
const { Schema } = require('mongoose');

const productSchema = new Schema({
    sku: { type: String, required: true },
    asin: { type: String, required: true },
    mlm: { type: String },
    upc: { type: String },
    img: { type: String },
    title: { type: String, required: true },
    pao: { type: String },
    dimension: { type: Number },
    pickPackFee: { type: Number },
    envioPromedio: { type: Number },
    ultimoProveedor: { type: String },
    fuente: { type: String },
    fnsku: { type: String },
    updatedAt: { type: Date },
    inventoryId: { type: String, required: true, index: true },
    referralFee: { type: Number },
    iva: { type: Number },
    satProductCode: { type: String },
    satUnitCode: { type: String },
    facturamaId: { type: String }
}, {
    collection: 'products'
});

// Índice para búsqueda eficiente por inventoryId
productSchema.index({ inventoryId: 1 });

module.exports = db.model('Product', productSchema);