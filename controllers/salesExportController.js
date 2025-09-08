// controllers/salesExportController.js

const { updateSheet, readSheet, clearSheet } = require('../config/googleSheetsConfig');
const Order = require('../models/meliOrder');
const logger = require('../config/logger');
const { meliRequest } = require('../config/meliconfig');
const { default: pLimit } = require('p-limit');

// ID del archivo de Google Sheets y nombres de las hojas
const SHEET_ID = '1f31R_Qd-h1Cvelgt0A98tGmb6x56UJK6qKIaX2Qxj1E';
const SHEET_NAME_ORDERS = 'Ordenes30';
const SHEET_NAME_VISITS = 'VisitasMLM';

// Encabezados de la hoja VisitasMLM
const VISITS_SHEET_HEADERS = ['MLM', 'SKU', 'Visitas'];

// Función auxiliar para pausar la ejecución
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Exporta las ventas a Google Sheets.
 */
const exportSalesToSheet = async (req, res) => {
    try {
        logger.info('Iniciando la exportación de ventas a Google Sheets de los últimos 30 días.');
        
        // Calcular la fecha de hace 30 días
        const fecha30DiasAtras = new Date();
        fecha30DiasAtras.setDate(fecha30DiasAtras.getDate() - 30);
        
        await clearSheet(SHEET_ID, `${SHEET_NAME_ORDERS}!A2:Z`);

        // Obtener todas las órdenes desde MongoDB con estado 'paid' y creadas en los últimos 30 días
        const orders = await Order.find({ 
            status: 'paid',
            date_created: { $gte: fecha30DiasAtras }
        }).exec();
        
        logger.info(`Órdenes obtenidas: ${orders.length}`);

        if (orders.length === 0) {
            logger.info('No se encontraron órdenes para exportar en los últimos 30 días.');
            return res.status(200).json({ message: 'No se encontraron órdenes para exportar en los últimos 30 días.' });
        }

        // Preparar los datos para la hoja
        const rows = [];

        orders.forEach(order => {
            order.order_items.forEach(item => {
                const fecha = new Date(order.date_created).toLocaleDateString('es-ES');
                const idVenta = `${order.order_id}`;
                const idProducto = `${item.id}`;
                const sku = `${item.seller_sku}`;
                const descripcion = item.title;
                const cantidad = item.quantity;
                const precioUnitario = (parseFloat(item.unit_price) / 1.16).toFixed(2);
                const precioAcumulado = ((item.quantity * parseFloat(item.unit_price)) / 1.16).toFixed(2);
                const comisionEnvio = (parseFloat(order.shipping_cost || 0) / 1.16).toFixed(2);
                const comisionVta = (parseFloat((item.sale_fee * item.quantity) || 0) / 1.16).toFixed(2);
                const costoProducto = parseFloat(item.product_cost || 0).toFixed(2);// El costo del producto se guarda sin IVA
                const costoAcum = (parseFloat(item.product_cost || 0) * item.quantity).toFixed(2);// El costo del producto se guarda sin IVA
                const ganancia = (parseFloat(precioAcumulado) - parseFloat(costoAcum) - parseFloat(comisionVta) - parseFloat(comisionEnvio)).toFixed(2);
                const roi = parseFloat(costoAcum) === 0 ? '0.00' : (parseFloat(ganancia) / parseFloat(costoAcum)).toFixed(2);

                rows.push([
                    fecha,
                    idVenta,
                    idProducto,
                    sku,
                    descripcion,
                    cantidad,
                    precioUnitario,
                    precioAcumulado,
                    comisionEnvio,
                    comisionVta,
                    costoProducto,
                    ganancia,
                    costoAcum,
                    roi
                ]);
            });
        });

        // Insertar los datos en Google Sheets
        await clearSheet(SHEET_ID, `${SHEET_NAME_ORDERS}!A2:N`);
        await updateSheet(SHEET_ID, `${SHEET_NAME_ORDERS}!A2`, rows);

        logger.info(`Exportación completada: ${rows.length} nuevas órdenes exportadas de los últimos 30 días.`);
        return res.status(200).json({ message: `Exportación completada: ${rows.length} nuevas órdenes exportadas de los últimos 30 días.` });
    } catch (error) {
        logger.error('Error al exportar ventas a Google Sheets:', error);
        return res.status(500).json({ error: 'Error al exportar ventas a Google Sheets.' });
    }
};

/**
 * Exporta las visitas de los productos a Google Sheets.
 */
const exportVisitsToSheet = async (req, res) => {
    try {
        logger.info('Iniciando la exportación de visitas a Google Sheets.');
              
        await clearSheet(SHEET_ID, `${SHEET_NAME_VISITS}!A2:C`);

        const treintaDiasAtras = new Date();
        treintaDiasAtras.setDate(treintaDiasAtras.getDate() - 30);
    
        // Obtener las órdenes con ventas en los últimos 30 días
        const orders = await Order.find({ 
            status: 'paid', 
            date_created: { $gte: treintaDiasAtras } 
        }).exec();
    
        logger.info(`Órdenes obtenidas para visitas: ${orders.length}`);
    
        if (orders.length === 0) {
            logger.info('No se encontraron órdenes con ventas en los últimos 30 días.');
            return res.status(200).json({ message: 'No se encontraron órdenes con ventas en los últimos 30 días.' });
        }
    
        // Extraer productos únicos
        const productosMap = new Map();
    
        orders.forEach(order => {
            order.order_items.forEach(item => {
                if (!productosMap.has(item.id)) {
                    productosMap.set(item.id, {
                        MLM: item.id,
                        SKU: item.seller_sku
                    });
                }
            });
        });
    
        const productos = Array.from(productosMap.values());
        logger.info(`Productos únicos para exportar visitas: ${productos.length}`);
    
        if (productos.length === 0) {
            logger.info('No se encontraron productos para exportar visitas.');
            return res.status(200).json({ message: 'No se encontraron productos para exportar visitas.' });
        }
    
        // Configurar límite de concurrencia para evitar rate limiting
        const limit = pLimit(10); // Máximo 10 requests simultáneos
        
        // Preparar las solicitudes de visitas con control de concurrencia
        const visitasPromises = productos.map(producto => 
            limit(async () => {
                try {
                    // Pequeño delay para evitar saturar la API
                    await sleep(100);
                    
                    const respuesta = await meliRequest(`items/${producto.MLM}/visits/time_window?last=30&unit=day`, 'GET');
                    if (respuesta.success) {
                        const visitas = respuesta.data.total_visits || 0;
                        logger.info(`Visitas para ${producto.MLM}: ${visitas}`);
                        return [producto.MLM, producto.SKU, visitas];
                    } else {
                        logger.warn(`No se pudo obtener visitas para el producto ${producto.MLM}: ${respuesta.error}`);
                        return [producto.MLM, producto.SKU, 'Error'];
                    }
                } catch (err) {
                    logger.error(`Error al obtener visitas para el producto ${producto.MLM}:`, err);
                    return [producto.MLM, producto.SKU, 'Error'];
                }
            })
        );
    
        logger.info('Procesando solicitudes de visitas en lotes controlados...');
        const datosVisitas = await Promise.all(visitasPromises);
    
        // Verificar y agregar encabezados si es necesario
        const existingHeaders = await readSheet(SHEET_ID, `${SHEET_NAME_VISITS}!A1:C1`);
        if (existingHeaders.length === 0 || existingHeaders[0].length === 0) {
            await updateSheet(SHEET_ID, `${SHEET_NAME_VISITS}!A1`, [VISITS_SHEET_HEADERS]);
        }
    
        // Insertar los datos en Google Sheets
        await updateSheet(SHEET_ID, `${SHEET_NAME_VISITS}!A2`, datosVisitas);
    
        logger.info(`Exportación completada: ${datosVisitas.length} registros de visitas exportados.`);
        return res.status(200).json({ message: `Exportación completada: ${datosVisitas.length} registros de visitas exportados.` });
    } catch (error) {
        logger.error('Error al exportar visitas a Google Sheets:', error);
        return res.status(500).json({ error: 'Error al exportar visitas a Google Sheets.' });
    }
};

module.exports = { exportSalesToSheet, exportVisitsToSheet };