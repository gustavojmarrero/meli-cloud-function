// index.js
const express = require('express');
const cors = require('cors');
const app = express();

// Configuración de CORS
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://myaccount.mercadolibre.com.mx',
      'https://www.mercadolibre.com.mx',
      'http://localhost:3000',
      'http://localhost:8080'
    ];

    // Permitir requests sin origin (como Postman o curl)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));

// Middleware para parsear JSON
app.use(express.json());

// Importar y usar las rutas
const notificationsRoutes = require('./routes/notificationsRoutes');
const ordersRoutes = require('./routes/ordersRoutes');
const productsRoutes = require('./routes/productsRoutes');
const catalogRoutes = require('./routes/catalogRoutes');

app.use('/api/notifications', notificationsRoutes);
app.use('/api/orders', ordersRoutes); // Endpoints de órdenes (export-sales, export-visits, process-pending)
app.use('/api/reports', ordersRoutes); // Endpoint de reportes (top-profit-skus)
app.use('/api/products', productsRoutes);
app.use('/api/mercadolibre', catalogRoutes);

// Exportar la aplicación para que Cloud Functions pueda manejarla
exports.meli = app;