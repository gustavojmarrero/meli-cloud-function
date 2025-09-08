#!/usr/bin/env node

const { updateOrderCosts } = require('../controllers/ordersController');
const logger = require('../config/logger');

const main = async () => {
    try {
        logger.info('Iniciando actualización de costos de órdenes...');
        await updateOrderCosts();
        logger.info('Proceso completado exitosamente.');
        process.exit(0);
    } catch (error) {
        logger.error('Error en el proceso de actualización:', error);
        process.exit(1);
    }
};

// Ejecutar si es llamado directamente
if (require.main === module) {
    main();
} 