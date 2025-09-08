console.log('Iniciando aplicación...');
const express = require('express');
console.log('Express importado correctamente');
const app = express();
console.log('Aplicación Express creada');

// Middleware para parsear JSON
app.use(express.json());

// Importar y usar las rutas
const meliNotificationsRoutes = require('./routes/notificationsRoutes');
const procesPendingOrdersRoutes = require('./routes/ordersRoutes');
const productsRoutes = require('./routes/productsRoutes');

app.use('/api/meliNotifications', meliNotificationsRoutes);
app.use('/api/pendingOrders', procesPendingOrdersRoutes);
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




