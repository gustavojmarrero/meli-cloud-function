//mongoDbConfig.js
require('dotenv').config();

const mongoose = require('mongoose');

// Obtenemos la URI de MongoDB
const mongoURI = `${process.env.URI_BD_GUATEVER}?maxPoolSize=5`; 



// Conectamos a MongoDB
mongoose.connect(mongoURI);
mongoose.set('strictQuery', false);

// Escuchamos evento de conexión
mongoose.connection.once('open', () => {
  console.log('Conectado a MongoDB');
});

// Escuchamos errores
mongoose.connection.on('error', err => {
  console.error(err);
});

// Exportamos la conexión
module.exports = mongoose.connection;
