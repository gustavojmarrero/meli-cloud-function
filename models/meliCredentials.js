// models/meliCredentials.js
const db = require('../config/mongoDbConfig');
const { Schema } = require('mongoose');

const melicrentialsSchema = new Schema({
    access_token: String,
    token_type: String,
    expires_in: Number,
    user_id:Number,
    refresh_token: String,
    last_update: Date,
},
 {
    collection: 'melicrentials'
}

);
module.exports = db.model('melicrentials', melicrentialsSchema );