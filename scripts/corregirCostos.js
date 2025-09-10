// Script para corregir costos de productos en órdenes existentes
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../config/mongoDbConfig');
const { corregirCostosProductos } = require('../controllers/ordersController');
const logger = require('../config/logger');

const main = async () => {
    try {
        logger.info('========================================');
        logger.info('Iniciando corrección de costos de productos');
        logger.info('========================================');
        
        // Esperar a que la conexión esté lista
        if (db.readyState !== 1) {
            logger.info('Esperando conexión a MongoDB...');
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout esperando conexión a MongoDB'));
                }, 10000);
                
                db.once('open', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }
        
        logger.info('✓ Conexión a MongoDB establecida');
        
        // Ejecutar la corrección de costos
        await corregirCostosProductos();
        
        logger.info('========================================');
        logger.info('✅ Corrección de costos completada');
        logger.info('========================================');
        
        process.exit(0);
    } catch (error) {
        logger.error('❌ Error en el script:', error);
        process.exit(1);
    }
};

if (require.main === module) {
    main();
}