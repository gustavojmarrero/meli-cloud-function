// index.js
const express = require('express');
const app = express();

// Middleware para parsear JSON
app.use(express.json());

// Importar y usar las rutas
const notificationsRoutes = require('./routes/notificationsRoutes');
const ordersRoutes = require('./routes/ordersRoutes');
const productsRoutes = require('./routes/productsRoutes');
const catalogRoutes = require('./routes/catalogRoutes');

app.use('/api/notifications', notificationsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/mercadolibre', catalogRoutes);

// Exportar la aplicación para que Cloud Functions pueda manejarla
exports.meli = app;