// models/ProductCost.js
const db = require('../config/mongoDbConfig');
const { Schema } = require('mongoose');

// Esquema para los costos históricos
const historicalCostSchema = new Schema({
    date: { type: Date, required: true }, // Fecha en la que el costo fue válido
    cost: { type: Number, required: true }, // Costo del producto en esa fecha
    source: { type: String, default: 'migration' } // Fuente del costo
}, { _id: false });

// Esquema para el producto con sus costos
const productCostSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: 'Product', index: true }, // Referencia al producto
    sku: { type: String, required: true, index: true }, // SKU del producto
    current_cost: { type: Number, required: true }, // Costo actual del producto
    historical_costs: [historicalCostSchema], // Array de objetos que contiene el historial de costos
}, {
    collection: 'productcosts', // Nombre de colección alineado con el backend
    timestamps: true // Habilitar timestamps automáticos para createdAt y updatedAt
});

module.exports = db.model('productCost', productCostSchema);