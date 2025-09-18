// models/asinCatalogMapping.js
const db = require('../config/mongoDbConfig');
const { Schema } = require('mongoose');

const asinCatalogMappingSchema = new Schema({
    mlCatalogId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    mlCategoryId: {
        type: String,
        required: true
    },
    firstListingPrice: {
        type: Number,
        default: 0
    },
    amazonPrice: {
        type: Number,
        required: true
    },
    mlShippingCost: {
        type: Number,
        required: true
    },
    mlSaleCommission: {
        type: Number,
        required: true,
        min: 0,
        max: 1 // Porcentaje como decimal (ej: 0.135 para 13.5%)
    },
    mlItemId: {
        type: String,
        default: null
    },
    mlm: {
        type: String,
        default: null
    },
    lastPublishedAt: {
        type: Date,
        default: null
    },
    sku: {
        type: String,
        default: null
    },
    itemIds: [{
        type: String
    }]
}, {
    collection: 'asincatalogmappings',
    timestamps: true
});

// Índices para búsquedas eficientes
asinCatalogMappingSchema.index({ mlItemId: 1 });
asinCatalogMappingSchema.index({ sku: 1 });

module.exports = db.model('AsinCatalogMapping', asinCatalogMappingSchema);
