// models/ProductCost.js
const db = require('../config/mongoDbConfig');
const { Schema } = require('mongoose');

// Esquema para los costos históricos
const historicalCostSchema = new Schema({
    date: { type: Date, required: true }, // Fecha en la que el costo fue válido
    cost: { type: Number, required: true } // Costo del producto en esa fecha
}, { _id: false });

// Esquema para el producto con sus costos
const productCostSchema = new Schema({
    sku: { type: String, required: true, unique: true }, // SKU del producto
    current_cost: { type: Number, required: true }, // Costo actual del producto
    historical_costs: [historicalCostSchema], // Array de objetos que contiene el historial de costos
}, { 
    collection: 'productCosts', // Nombre explícito de la colección
    timestamps: true // Habilitar timestamps automáticos para createdAt y updatedAt
});

module.exports = db.model('productCost', productCostSchema);