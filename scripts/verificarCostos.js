// Script para verificar órdenes sin costos
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const db = require('../config/mongoDbConfig');
const Order = require('../models/meliOrder');
const logger = require('../config/logger');

const main = async () => {
    try {
        // Esperar conexión a MongoDB
        if (db.readyState !== 1) {
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
        
        // Buscar órdenes de los últimos 7 días
        const sieteDiasAtras = new Date();
        sieteDiasAtras.setDate(sieteDiasAtras.getDate() - 7);
        
        // Contar órdenes con items sin costo
        const ordenesConCostoCero = await Order.find({
            'date_created': { $gte: sieteDiasAtras },
            $or: [
                { 'order_items.product_cost': 0 },
                { 'order_items.product_cost': { $exists: false } }
            ]
        }).countDocuments();
        
        // Contar total de órdenes en los últimos 7 días
        const totalOrdenes = await Order.find({
            'date_created': { $gte: sieteDiasAtras }
        }).countDocuments();
        
        // Obtener muestra de órdenes recientes con costos
        const muestraOrdenes = await Order.find({
            'date_created': { $gte: sieteDiasAtras }
        })
        .sort({ 'date_created': -1 })
        .limit(5)
        .select('order_id date_created order_items.seller_sku order_items.product_cost order_items.title');
        
        logger.info('========================================');
        logger.info('REPORTE DE VERIFICACIÓN DE COSTOS');
        logger.info('========================================');
        logger.info(`Total de órdenes (últimos 7 días): ${totalOrdenes}`);
        logger.info(`Órdenes con items sin costo: ${ordenesConCostoCero}`);
        logger.info(`Porcentaje con costos completos: ${((totalOrdenes - ordenesConCostoCero) / totalOrdenes * 100).toFixed(2)}%`);
        logger.info('');
        logger.info('MUESTRA DE ÓRDENES RECIENTES:');
        logger.info('----------------------------------------');
        
        muestraOrdenes.forEach(orden => {
            logger.info(`Orden: ${orden.order_id} - Fecha: ${orden.date_created.toISOString().split('T')[0]}`);
            orden.order_items.forEach(item => {
                const estado = item.product_cost > 0 ? '✓' : '✗';
                logger.info(`  ${estado} ${item.title.substring(0, 40)}... - SKU: ${item.seller_sku} - Costo: $${item.product_cost || 0}`);
            });
            logger.info('');
        });
        
        logger.info('========================================');
        
        process.exit(0);
    } catch (error) {
        logger.error('❌ Error:', error);
        process.exit(1);
    }
};

if (require.main === module) {
    main();
}