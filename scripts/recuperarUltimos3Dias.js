// scripts/recuperarUltimos3Dias.js
// Script temporal para recuperar órdenes de los últimos 3 días

console.log('Iniciando script de recuperación de órdenes...');

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

console.log('Variables de entorno cargadas');

const db = require('../config/mongoDbConfig');
const { saveOrUpdateOrders } = require('../controllers/ordersController');
const { meliRequest } = require('../config/meliconfig');
const logger = require('../config/logger');

console.log('Módulos importados correctamente');

// Función auxiliar para pausar la ejecución
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función para inicializar las órdenes de los últimos 3 días
const initializeLastThreeDaysOrders = async () => {
    try {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        let offset = 0;
        const limit = 50; // Máximo permitido por la API de MercadoLibre
        let totalOrders = 0;
        let processedOrders = 0;

        logger.info('========================================');
        logger.info('Iniciando la descarga de órdenes de los últimos 3 días.');
        logger.info(`Fecha de inicio: ${threeDaysAgo.toISOString()}`);
        logger.info(`MELI_USER_ID: ${process.env.MELI_USER_ID}`);
        logger.info('========================================');

        while (true) {
            logger.info(`Solicitando órdenes con offset ${offset}, limit ${limit}...`);
            
            const endpoint = `orders/search?seller=${process.env.MELI_USER_ID}&order.date_created.from=${threeDaysAgo.toISOString()}&sort=date_desc&offset=${offset}&limit=${limit}`;
            const response = await meliRequest(endpoint, 'GET');

            if (!response.success) {
                logger.error(`Error al obtener órdenes: ${response.error}`);
                break;
            }

            const results = response.data.results;
            totalOrders = response.data.paging.total;

            logger.info(`Recibidas ${results.length} órdenes. Total en API: ${totalOrders}`);

            if (results.length === 0) {
                logger.info('No hay más órdenes para procesar.');
                break;
            }

            // Procesar las órdenes
            if (results.length > 0) {
                logger.info(`Guardando batch de ${results.length} órdenes...`);
                await saveOrUpdateOrders(results);
                processedOrders += results.length;
            }

            offset += limit;

            const percentage = ((Math.min(offset, totalOrders) / totalOrders) * 100).toFixed(2);
            logger.info(`✓ Procesadas ${Math.min(offset, totalOrders)}/${totalOrders} órdenes (${percentage}%)`);

            // Pausa para respetar las cuotas de la API
            await sleep(1000); // Esperar 1 segundo
        }

        logger.info('========================================');
        logger.info(`✅ Proceso completado: ${processedOrders} órdenes procesadas.`);
        logger.info('========================================');
        
        return processedOrders;
    } catch (error) {
        logger.error('❌ Error al inicializar las órdenes de los últimos 3 días:', error);
        throw error;
    }
};

// Función principal para ejecutar el script
const main = async () => {
    try {
        console.log('Ejecutando función principal...');
        
        // La conexión a MongoDB ya está establecida por mongoDbConfig.js
        logger.info('Esperando conexión a MongoDB...');
        
        // Esperar a que la conexión esté lista
        if (db.readyState !== 1) {
            console.log('Esperando que MongoDB se conecte...');
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout esperando conexión a MongoDB'));
                }, 10000); // 10 segundos de timeout
                
                db.once('open', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }
        
        logger.info('✓ Conexión a MongoDB establecida');

        // Ejecutar la función de recuperación
        const ordenesProcessadas = await initializeLastThreeDaysOrders();

        logger.info('========================================');
        logger.info(`✅ Script completado exitosamente`);
        logger.info(`Total de órdenes procesadas: ${ordenesProcessadas}`);
        logger.info('========================================');
        
        process.exit(0);
    } catch (error) {
        console.error('Error fatal:', error);
        logger.error('❌ Error en el script:', error);
        process.exit(1);
    }
};

// Ejecutar el script si se llama directamente
if (require.main === module) {
    console.log('Script llamado directamente, ejecutando main()...');
    main();
}

module.exports = { initializeLastThreeDaysOrders };