const express = require('express');
const router = express.Router();
const { processPending } = require('../controllers/ordersController');
const { exportSalesToSheet, exportVisitsToSheet } = require('../controllers/salesExportController');
const { initializeLastThreeDaysOrders } = require('../scripts/recuperarUltimos3Dias');

router.post('/process-pending', processPending);
router.post('/export-sales', exportSalesToSheet); // Nuevo endpoint para exportar ventas
router.post('/export-visits', exportVisitsToSheet); // Nuevo endpoint para exportar visitas

// Endpoint temporal para recuperar órdenes de los últimos 3 días
router.post('/recuperar-ultimos-3-dias', async (req, res) => {
    try {
        const ordenesProcessadas = await initializeLastThreeDaysOrders();
        res.json({
            success: true,
            message: `Proceso completado: ${ordenesProcessadas} órdenes procesadas`,
            ordenes: ordenesProcessadas
        });
    } catch (error) {
        console.error('Error ejecutando recuperación:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;