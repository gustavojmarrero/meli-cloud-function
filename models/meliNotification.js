// models/meliNotification.js
const db = require('../config/mongoDbConfig');
const { Schema } = require('mongoose');

const notificationSchema = new Schema({
    _id: String,
    resource: String,
    user_id: Number,
    topic: String,
    application_id: Number,
    attempts: Number,
    sent: Date,
    received: Date,
    processed: { type: Boolean, default: false } // Campo agregado para indicar si la notificación ha sido procesada
},
{
    collection: 'meliNotifications' // Actualizado el nombre de la colección
});

module.exports = db.model('MeliNotification', notificationSchema);
