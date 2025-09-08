    // models/meliOrder.js
    const db = require('../config/mongoDbConfig');
    const { Schema } = require('mongoose');

    const orderItemSchema = new Schema({
        id: String,
        title: String,
        category_id: String,
        variation_id: String,
        seller_sku: String,
        quantity: Number,
        unit_price: Number,
        sale_fee: Number,
        product_cost: { type: Number, default: 0 } // Nuevo campo para el costo del producto
    });

    const meliOrderSchema = new Schema({
        order_id: { type: String, required: true, unique: true },
        date_created: { type: Date, required: true },
        pack_id: { type: String },
        order_items: [orderItemSchema],
        shipping_id: { type: String },
        shipping_cost: { type: Number, default: 0 }, // Nuevo campo para el costo de envío
        buyer: {
            id: Number,
            nickname: String,
            first_name: String,
            last_name: String
        },
        status: { type: String },
    }, {
    collection: 'meliorders' 
});

module.exports = db.model('meliorders', meliOrderSchema);