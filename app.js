console.log('Iniciando aplicación...');
const express = require('express');
const cors = require('cors');
console.log('Express importado correctamente');
const app = express();
console.log('Aplicación Express creada');

// Configuración de CORS más flexible
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
const meliNotificationsRoutes = require('./routes/notificationsRoutes');
const ordersRoutes = require('./routes/ordersRoutes');
const productsRoutes = require('./routes/productsRoutes');

app.use('/api/meliNotifications', meliNotificationsRoutes);
app.use('/api/reports', ordersRoutes); // Cambiado de /api/pendingOrders a /api/reports
app.use('/api/products', productsRoutes);

// Manejo de errores genéricos
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Algo salió mal!');
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Servidor escuchando en el puerto ${port}`);
});

// Exportar la función principal para Google Cloud Functions
const server = app;

// Exportar el servidor para que lo maneje Google Cloud Functions
module.exports = {
  app: server
};



