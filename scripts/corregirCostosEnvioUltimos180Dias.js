#!/usr/bin/env node

const { corregirCostosEnvioUltimos180Dias } = require('../controllers/ordersController');
const logger = require('../config/logger');

const main = async () => {
    try {
        logger.info('Iniciando corrección de costos de envío de las últimas 180 días...');
        await corregirCostosEnvioUltimos180Dias();
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