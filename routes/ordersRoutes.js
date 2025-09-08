const express = require('express');
const router = express.Router();
const { processPending } = require('../controllers/ordersController');
const { exportSalesToSheet, exportVisitsToSheet } = require('../controllers/salesExportController');

router.post('/process-pending', processPending);
router.post('/export-sales', exportSalesToSheet); // Nuevo endpoint para exportar ventas
router.post('/export-visits', exportVisitsToSheet); // Nuevo endpoint para exportar visitas

module.exports = router;