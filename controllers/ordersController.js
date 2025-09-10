// controllers/ordersController.js

const Order = require('../models/meliOrder');
const Notification = require('../models/meliNotification');
const { meliRequest } = require('../config/meliconfig');
const ProductCost = require('../models/productCost');
const logger = require('../config/logger');

// Función auxiliar para pausar la ejecución
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función para procesar las notificaciones pendientes de tipo 'orders_v2'

const processPending = async (req, res) => {
    try {
        // Obtener órdenes existentes con campos específicos según el modelo
        const existingOrders = await Order.find({}, { 
            order_id: 1, 
            status: 1, 
            shipping_cost: 1,
            shipping_id: 1,
            pack_id: 1,
            order_items: 1,
            _id: 0 
        }).lean();
        
        const orderStatusMap = new Map(existingOrders.map(order => [order.order_id, order]));

        // Agrupar notificaciones por orden
        const pendingNotifications = await Notification.aggregate([
            { 
                $match: { 
                    processed: false, 
                    topic: 'orders_v2' 
                }
            },
            {
                $addFields: {
                    order_id: {
                        $arrayElemAt: [
                            { $split: ["$resource", "/"] },
                            -1
                        ]
                    }
                }
            },
            {
                $sort: { 
                    received: -1 
                }
            },
            {
                $group: {
                    _id: "$order_id",
                    lastNotification: { $first: "$$ROOT" },
                    notificationCount: { $sum: 1 }
                }
            }
        ]);

        if (pendingNotifications.length === 0) {
            logger.info('No hay notificaciones de órdenes pendientes por procesar.');
            return res.status(200).json({ message: 'No hay notificaciones de órdenes pendientes por procesar.' });
        }

        const ordersToProcess = new Map();
        const shippingIdsToProcess = new Set();

        // Determinar qué órdenes necesitan actualización
        for (const notification of pendingNotifications) {
            const orderId = notification._id;
            const existingOrder = orderStatusMap.get(orderId);

            if (shouldProcessOrder(existingOrder, notification.lastNotification)) {
                ordersToProcess.set(orderId, {
                    notification: notification.lastNotification,
                    needsShippingCost: !existingOrder?.shipping_cost,
                    existingOrder
                });
            }
        }

        logger.info(`Procesando ${ordersToProcess.size} órdenes únicas pendientes.`);

        // Primero, obtener todas las órdenes de la API y recolectar SKUs
        const ordersFromAPI = new Map();
        const skusToSearch = new Set();
        
        for (const [orderId, orderData] of ordersToProcess) {
            const response = await meliRequest(`orders/${orderId}`);
            if (response.success) {
                ordersFromAPI.set(orderId, response.data);
                response.data.order_items.forEach(item => {
                    if (item.item.seller_sku) {
                        skusToSearch.add(item.item.seller_sku);
                    }
                });
            }
        }
        
        // Buscar todos los costos de una vez
        const productCosts = await ProductCost.find({ 
            sku: { $in: Array.from(skusToSearch) } 
        }).lean();
        
        const costMap = new Map();
        productCosts.forEach(product => {
            costMap.set(product.sku, product.current_cost || 0);
        });

        // Procesar las órdenes que necesitan actualización
        for (const [orderId, orderData] of ordersToProcess) {
            const orderInfo = ordersFromAPI.get(orderId);
            if (!orderInfo) {
                logger.error(`No se pudo obtener datos de la orden ${orderId}`);
                continue;
            }
            
            // Preparar los datos según el esquema
            const orderUpdate = {
                order_id: orderInfo.id,
                date_created: orderInfo.date_created,
                pack_id: orderInfo.pack_id || null,
                status: orderInfo.status,
                shipping_id: orderInfo.shipping?.id || null,
                buyer: {
                    id: orderInfo.buyer.id,
                    nickname: orderInfo.buyer.nickname,
                    first_name: orderInfo.buyer.first_name || '',
                    last_name: orderInfo.buyer.last_name || ''
                },
                order_items: orderInfo.order_items.map(item => ({
                    id: item.item.id,
                    title: item.item.title,
                    category_id: item.item.category_id,
                    variation_id: item.item.variation_id,
                    seller_sku: item.item.seller_sku,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    sale_fee: item.sale_fee,
                    product_cost: costMap.get(item.item.seller_sku) || 0
                }))
            };

            // Solo agregar shipping_id si necesitamos el costo
            if (orderData.needsShippingCost && orderInfo.shipping?.id) {
                shippingIdsToProcess.add(orderInfo.shipping.id);
            }

            // Actualizar o crear la orden
            await Order.findOneAndUpdate(
                { order_id: orderId },
                { $set: orderUpdate },
                { upsert: true, new: true }
            );

            logger.info(`Orden ${orderId} actualizada/creada correctamente.`);
        }

        // Procesar costos de envío en batch
        if (shippingIdsToProcess.size > 0) {
            const shippingCosts = await processShippingCostsInBatch(Array.from(shippingIdsToProcess));
            
            // Actualizar costos de envío
            for (const [shippingId, cost] of shippingCosts) {
                await Order.updateOne(
                    { shipping_id: shippingId },
                    { $set: { shipping_cost: cost } }
                );
            }
        }

        // Marcar notificaciones como procesadas
        const notificationIds = pendingNotifications.map(n => n.lastNotification._id);
        await Notification.updateMany(
            { _id: { $in: notificationIds } },
            { $set: { processed: true } }
        );

        return res.status(200).json({
            message: `${ordersToProcess.size} órdenes procesadas.`,
            processedOrders: ordersToProcess.size
        });
    } catch (error) {
        logger.error('Error al procesar notificaciones de órdenes pendientes:', error);
        return res.status(500).json({ error: 'Error al procesar notificaciones de órdenes pendientes.' });
    }
};

const shouldProcessOrder = (existingOrder, notification) => {
    if (!existingOrder) return true;

    // Estados finales que no necesitan actualización
    const finalStates = ['cancelled', 'delivered'];
    if (finalStates.includes(existingOrder.status)) return false;

    // Procesar si:
    // 1. No tiene costo de envío y debería tenerlo
    // 2. Tiene items sin costo de producto
    // 3. No tiene shipping_id pero debería tenerlo
    return (
        (existingOrder.shipping_cost === 0 && existingOrder.shipping_id) ||
        existingOrder.order_items.some(item => item.product_cost === 0) ||
        (!existingOrder.shipping_id && ['paid', 'shipped'].includes(existingOrder.status))
    );
};

const processShippingCostsInBatch = async (shippingIds) => {
    const shippingCosts = new Map();
    const batchSize = 50;

    for (let i = 0; i < shippingIds.length; i += batchSize) {
        const batch = shippingIds.slice(i, i + batchSize);
        const promises = batch.map(async (shippingId) => {
            try {
                const response = await meliRequest(`shipments/${shippingId}`);
                if (response.success && response.data.shipping_option) {
                    // Calcular el costo real del envío
                    const totalCost = response.data.shipping_option.list_cost || 0;
                    const clientCost = response.data.shipping_option.cost || 0;
                    const realShippingCost = totalCost - clientCost;
                    
                    logger.info(`Envío ${shippingId}: Costo total: ${totalCost}, Cliente paga: ${clientCost}, Costo real: ${realShippingCost}`);
                    
                    shippingCosts.set(
                        shippingId, 
                        realShippingCost
                    );
                }
            } catch (error) {
                logger.error(`Error al obtener costo de envío para ${shippingId}:`, error);
            }
        });
        await Promise.all(promises);
        await sleep(1000); // Respetar límites de API
    }

    return shippingCosts;
};

// Función para actualizar costos de envío en lote
const corregirCostosDeEnvio = async () => {
    try {
        // Obtener todas las órdenes con shipping_cost igual a 0
        const ordersConCostoCero = await Order.find({ shipping_cost: 0 }).select('shipping_id order_id').exec();
        
        if (ordersConCostoCero.length === 0) {
            logger.info('No hay órdenes con costo de envío igual a 0 para actualizar.');
            return;
        }

        logger.info(`Encontradas ${ordersConCostoCero.length} órdenes con costo de envío igual a 0.`);
        
        let processedShippings = 0;
        const totalShippings = ordersConCostoCero.length;

        for (const order of ordersConCostoCero) {
            let shippingId = order.shipping_id;
            const orderId = order.order_id;

            // Si shipping_id no está almacenado, obtenerlo desde la API de MercadoLibre
            if (!shippingId) {
                logger.info(`shipping_id no encontrado para la orden ${orderId}. Obteniendo datos de la orden desde la API.`);
                const orderResponse = await meliRequest(`orders/${orderId}`, 'GET');

                if (orderResponse.success) {
                    const orderData = orderResponse.data;
                    shippingId = orderData.shipping && orderData.shipping.id ? orderData.shipping.id : null;

                    if (shippingId) {
                        // Actualizar el shipping_id en la orden
                        order.shipping_id = shippingId;
                        await order.save();
                        logger.info(`shipping_id actualizado para la orden ${orderId}: ${shippingId}`);
                    } else {
                        logger.warn(`No se pudo obtener shipping_id para la orden ${orderId} desde la API.`);
                        processedShippings++;
                        continue;
                    }
                } else {
                    logger.error(`Error al obtener datos de la orden ${orderId}: ${orderResponse.error}`);
                    processedShippings++;
                    continue;
                }
            }

            // Obtener el costo de envío
            const response = await meliRequest(`shipments/${shippingId}`);

            if (response.success && response.data.shipping_option) {
                // Calcular el costo real del envío
                const totalCost = response.data.shipping_option.list_cost || 0;
                const clientCost = response.data.shipping_option.cost || 0;
                const realShippingCost = totalCost - clientCost;

                logger.info(`Envío ${shippingId}: Costo total: $${totalCost}, Cliente paga: $${clientCost}, Costo real: $${realShippingCost}`);
                
                await Order.updateOne(
                    { shipping_id: shippingId },
                    { $set: { shipping_cost: realShippingCost } }
                );

                logger.info(`Costo de envío actualizado para la orden ${orderId} con shipping_id ${shippingId}: $${realShippingCost}`);
            } else {
                logger.warn(`No se encontró el costo de envío para el shipping_id ${shippingId} de la orden ${orderId}.`);
            }

            processedShippings++;
            if (processedShippings % 10 === 0 || processedShippings === totalShippings) {
                const percentComplete = ((processedShippings / totalShippings) * 100).toFixed(2);
                logger.info(`Actualizados ${processedShippings}/${totalShippings} costos de envío (${percentComplete}%)`);
            }

            // Pausa para respetar las cuotas de la API
            await sleep(500);
        }

        logger.info('Proceso de corrección de costos de envío completado.');
    } catch (error) {
        logger.error('Error al actualizar costos de envío:', error);
        throw error;
    }
};

// Función para restablecer órdenes y notificaciones
const resetOrdersAndNotifications = async () => {
    try {
        await Order.deleteMany({});
        await Notification.updateMany(
            { topic: 'orders_v2', processed: true },
            { $set: { processed: false } }
        );

        logger.info('Órdenes eliminadas y notificaciones restablecidas correctamente.');
    } catch (error) {
        logger.error('Error al restablecer órdenes y notificaciones:', error);
    }
};

// Función para inicializar las órdenes del último año
const initializeLastYearOrders = async () => {
    try {
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        let offset = 0;
        const limit = 50; // Máximo permitido por la API de MercadoLibre
        let totalOrders = 0;

        logger.info('Iniciando la descarga de órdenes del último año.');

        while (true) {
            const response = await meliRequest(`orders/search?seller=${process.env.MELI_USER_ID}&order.date_created.from=${oneYearAgo.toISOString()}&sort=date_desc&offset=${offset}&limit=${limit}`, 'GET');

            if (!response.success) {
                logger.error(`Error al obtener órdenes: ${response.error}`);
                break;
            }

            const results = response.data.results;
            totalOrders = response.data.paging.total;

            if (results.length === 0) {
                break;
            }

            // Filtrar órdenes que no existen en la base de datos o que tienen costo 0 en el envío o algún producto con costo 0
            const ordersToUpdate = [];
            for (const order of results) {
                const existingOrder = await Order.findOne({ order_id: order.id }).lean();
                if (!existingOrder || existingOrder.shipping_cost === 0 || order.order_items.some(item => item.product_cost === 0)) {
                    ordersToUpdate.push(order);
                }
            }

            if (ordersToUpdate.length > 0) {
                // Guardar o actualizar las órdenes filtradas
                await saveOrUpdateOrders(ordersToUpdate);
            }

            offset += limit;

            logger.info(`Procesadas ${Math.min(offset, totalOrders)}/${totalOrders} órdenes (${((Math.min(offset, totalOrders) / totalOrders) * 100).toFixed(2)}%)`);

            // Pausa para respetar las cuotas de la API
            await sleep(1000); // Esperar 1 segundo
        }

        logger.info('Órdenes del último año guardadas correctamente.');
    } catch (error) {
        logger.error('Error al inicializar las órdenes del último año:', error);
    }
};

const saveOrUpdateOrders = async (ordersData) => {
    try {
        const bulkOps = [];
        const shippingIds = new Set();
        const skuDateMap = new Map();

        // Recolectar todos los SKUs y fechas de las órdenes
        for (const orderData of ordersData) {
            const orderDate = new Date(orderData.date_created);
            for (const item of orderData.order_items) {
                if (item.item.seller_sku) {
                    const sku = item.item.seller_sku;
                    if (!skuDateMap.has(sku)) {
                        skuDateMap.set(sku, new Set());
                    }
                    skuDateMap.get(sku).add(orderDate);
                }
            }
            // Verifica si la orden tiene un ID de envío y si el costo de envío es 0 o no está definido.
            if (orderData.shipping.id && (orderData.shipping_cost === 0 || orderData.shipping_cost === undefined)) {
                shippingIds.add(orderData.shipping.id);
            }
        }

        // Obtener los SKUs y sus fechas correspondientes
        const skus = Array.from(skuDateMap.keys());
        const productCosts = await ProductCost.find({ sku: { $in: skus } }).lean();
        const costMap = new Map();

        // Crear un mapa de SKU a sus costos históricos y current_cost
        for (const product of productCosts) {
            const sku = product.sku;
            const historicalCosts = product.historical_costs || [];
            // Ordenar costos históricos por fecha ascendente
            historicalCosts.sort((a, b) => new Date(a.date) - new Date(b.date));
            costMap.set(sku, {
                historicalCosts,
                currentCost: product.current_cost || 0 // Asegurar que current_cost esté disponible
            });
        }

        // Crear operaciones bulk para órdenes
        for (const orderData of ordersData) {
            const orderDate = new Date(orderData.date_created);
            const orderItems = orderData.order_items.map(item => {
                const sku = item.item.seller_sku;
                const costData = costMap.get(sku) || { historicalCosts: [], currentCost: 0 };
                const historicalCosts = costData.historicalCosts;
                let productCost = 0;

                if (historicalCosts.length > 0) {
                    // Encontrar el costo histórico más cercano anterior o igual a la fecha de la orden
                    for (let i = historicalCosts.length - 1; i >= 0; i--) {
                        const costEntry = historicalCosts[i];
                        if (new Date(costEntry.date) <= orderDate) {
                            productCost = costEntry.cost;
                            break;
                        }
                    }
                }

                if (historicalCosts.length === 0 || productCost === 0) {
                    // Si no hay costos históricos, usar current_cost
                    productCost = costData.currentCost;
                }

                return {
                    id: item.item.id,
                    title: item.item.title,
                    category_id: item.item.category_id,
                    variation_id: item.item.variation_id,
                    seller_sku: sku,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    sale_fee: item.sale_fee,
                    product_cost: productCost
                };
            });

            const bulkOp = {
                updateOne: {
                    filter: { order_id: orderData.id },
                    update: {
                        $set: {
                            date_created: orderData.date_created,
                            shipping_id: orderData.shipping.id,
                            buyer: {
                                id: orderData.buyer.id,
                                nickname: orderData.buyer.nickname,
                                first_name: orderData.buyer.first_name || '', // Asegurar que siempre tenga valor
                                last_name: orderData.buyer.last_name || ''   // Asegurar que siempre tenga valor
                            },
                            status: orderData.status,
                            order_items: orderItems,
                            shipping_cost: orderData.shipping_cost || 0
                        },
                        $setOnInsert: { order_id: orderData.id }
                    },
                    upsert: true
                }
            };

            // Verificar si el estado ha cambiado de 'paid' a 'cancelled'
            if (orderData.status === 'cancelled') {
                bulkOp.updateOne.update.$set.status = 'cancelled';
            }

            bulkOps.push(bulkOp);
        }

        // Ejecutar operaciones bulk
        if (bulkOps.length > 0) {
            await Order.bulkWrite(bulkOps);
        }

        // Actualizar costos de envío
        for (const shippingId of shippingIds) {
            const existingOrder = await Order.findOne({ shipping_id: shippingId }).exec();
            if (existingOrder && existingOrder.shipping_cost === 0) {
                const response = await meliRequest(`shipments/${shippingId}`);
                if (response.success && response.data.shipping_option && response.data.shipping_option.list_cost !== undefined) {
                    const shippingCost = response.data.shipping_option.list_cost;
                    await Order.updateOne(
                        { shipping_id: shippingId },
                        { $set: { shipping_cost: shippingCost } }
                    );
                    logger.info(`Costo de envío actualizado para el envío ${shippingId}: $${shippingCost}`);
                } else {
                    logger.warn(`No se encontró el costo de envío para el shipping_id ${shippingId}`);
                }
            }
        }

        logger.info('Órdenes guardadas o actualizadas correctamente con costos históricos y current_cost.');
    } catch (error) {
        logger.error('Error al guardar o actualizar órdenes:', error);
        throw error;
    }
};

/**
 * Función de corrección para actualizar el costo de los productos en las órdenes que tengan items con costo 0.
 */
const corregirCostosProductos = async () => {
    try {
        logger.info('Iniciando la corrección de costos de productos en órdenes.');

        // Encontrar todas las órdenes que tienen al menos un item con costo de producto 0
        const treintaDiasAtras = new Date();
        treintaDiasAtras.setDate(treintaDiasAtras.getDate() - 30);

        const ordenesConCostoCero = await Order.find({
            $or: [
                { 'order_items.product_cost': 0 },
                { 'order_items.product_cost': { $exists: false } }
            ],
            'date_created': { $gte: treintaDiasAtras }
        });

        if (ordenesConCostoCero.length === 0) {
            return logger.info('No se encontraron órdenes con items de costo de producto 0.');
        }

        logger.info(`Órdenes encontradas con items de costo de producto 0: ${ordenesConCostoCero.length}`);

        let totalItemsActualizados = 0;

        await Promise.all(ordenesConCostoCero.map(async (orden) => {
            let actualizacionesOrden = 0;

            await Promise.all(orden.order_items.map(async (item) => {
                if (item.product_cost === 0 || item.product_cost === undefined) {
                    // Obtener el costo correcto desde la colección ProductCost
                    const productoCosto = await ProductCost.findOne({ sku: item.seller_sku }).lean();

                    if (productoCosto && productoCosto.current_cost) {
                        item.product_cost = productoCosto.current_cost;
                        actualizacionesOrden++;
                        totalItemsActualizados++;
                    } else {
                        logger.warn(`No se encontró costo para SKU: ${item.seller_sku} en la orden ID: ${orden.order_id}`);
                    }
                }
            }));

            if (actualizacionesOrden > 0) {
                await orden.save();
                logger.info(`Orden ID: ${orden.order_id} actualizada con ${actualizacionesOrden} items corregidos.`);
            }
        }));

        return logger.info(`Corrección completada: ${totalItemsActualizados} items actualizados en total.`);
        

    } catch (error) {
        return  logger.error('Error al corregir costos de productos en las órdenes:', error);
    }
};

/**
 * Función para distribuir el costo de envío entre múltiples órdenes que comparten el mismo shipping_id.
 * 
 * Esta función realiza los siguientes pasos:
 * 1. Registra el inicio del proceso en los logs.
 * 2. Utiliza una agregación para encontrar shipping_id que aparecen en dos o más documentos.
 * 3. Itera sobre cada grupo de shipping_id que aparecen al menos dos veces.
 * 4. Calcula el costo de envío por documento dividiendo el costo total de envío entre la cantidad de documentos.
 * 5. Actualiza todos los documentos con el shipping_id correspondiente, estableciendo el costo de envío calculado.
 * 6. Registra en los logs la distribución del costo de envío para cada grupo de shipping_id.
 * 7. Registra en los logs la finalización del proceso.
 */
const distributeShippingCost = async () => {
    try {
        logger.info('Iniciando la distribución de costos de envío.');

        const shippingGroups = await Order.aggregate([
            {
                $match: {
                    shipping_id: { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: "$shipping_id",
                    totalShippingCost: { $sum: "$shipping_cost" },
                    count: { $sum: 1 }
                }
            },
            {
                $match: {
                    count: { $gte: 2 }
                }
            }
        ]);

        for (const group of shippingGroups) {
            const { _id: shippingId, totalShippingCost, count } = group;
            const shippingCostPerDoc = totalShippingCost / count;

            await Order.updateMany(
                { shipping_id: shippingId },
                { $set: { shipping_cost: shippingCostPerDoc } }
            );

            logger.info(`Costo de envío de $${totalShippingCost.toFixed(2)} distribuido entre ${count} documentos con shipping_id ${shippingId}. Cada documento tiene un shipping_cost de $${shippingCostPerDoc.toFixed(2)}.`);
        }

        logger.info('Distribución de costos de envío completada correctamente.');
    } catch (error) {
        logger.error('Error al distribuir costos de envío:', error);
    }
};

/**
 * Función para completar órdenes incompletas.
 * 
 * Esta función busca todas las órdenes con estado 'paid' que:
 * - No tengan items (`order_items` vacío).
 * - Tengan un costo de envío (`shipping_cost`) igual a 0.
 * 
 * Para cada orden encontrada, realiza una solicitud a la API de MercadoLibre para obtener los datos completos
 * y actualiza la orden en la base de datos con la información obtenida.
 */

const completarOrdenesIncompletas = async () => {
    try {
        logger.info('Iniciando la corrección de órdenes con datos incompletos.');

        // Encontrar órdenes con estado 'paid' que no tengan items o tengan costo de envío igual a 0
        const ordenesIncompletas = await Order.find({
            status: 'paid',
            $or: [
                { order_items: { $exists: true, $size: 0 } },
                { shipping_cost: 0 }
            ]
        }).exec();

        if (ordenesIncompletas.length === 0) {
            logger.info('No se encontraron órdenes con datos incompletos para corregir.');
            return;
        }

        logger.info(`Órdenes encontradas para corregir: ${ordenesIncompletas.length}`);

        let ordenesProcesadas = 0;

        for (const orden of ordenesIncompletas) {
            try {
                const orderId = orden.order_id;
                const endpoint = `orders/${orderId}`;

                // Realizar solicitud a la API de MercadoLibre para obtener los datos completos de la orden
                const response = await meliRequest(endpoint, 'GET');

                if (response.success) {
                    const orderData = response.data;

                    // Actualizar los campos necesarios
                    orden.order_items = orderData.order_items.map(item => ({
                        id: item.item.id,
                        title: item.item.title,
                        category_id: item.item.category_id,
                        variation_id: item.item.variation_id,
                        seller_sku: item.item.seller_sku,
                        quantity: item.quantity,
                        unit_price: item.unit_price,
                        sale_fee: item.sale_fee,
                        product_cost: 0 // Inicialmente, se puede actualizar más adelante si es necesario
                    }));

                    orden.shipping_cost = orderData.shipping_option && orderData.shipping_option.list_cost
                        ? orderData.shipping_option.list_cost
                        : 0;

                    orden.date_created = orderData.date_created ? new Date(orderData.date_created) : orden.date_created;

                    orden.buyer = {
                        id: orderData.buyer && orderData.buyer.id ? orderData.buyer.id : orden.buyer.id,
                        nickname: orderData.buyer && orderData.buyer.nickname ? orderData.buyer.nickname : orden.buyer.nickname,
                        first_name: orderData.buyer && orderData.buyer.first_name ? orderData.buyer.first_name : orden.buyer.first_name,
                        last_name: orderData.buyer && orderData.buyer.last_name ? orderData.buyer.last_name : orden.buyer.last_name
                    };

                    orden.status = orderData.status ? orderData.status : orden.status;

                    // Guardar los cambios en la base de datos
                    await orden.save();

                    logger.info(`Orden ${orderId} actualizada correctamente.`);
                } else {
                    logger.error(`Error al obtener datos de la orden ${orderId}: ${response.error}`);
                }
            } catch (error) {
                logger.error(`Error al procesar la orden ${orden.order_id}:`, error);
            }

            ordenesProcesadas++;

            // Registrar el progreso cada 10 órdenes o al final
            if (ordenesProcesadas % 10 === 0 || ordenesProcesadas === ordenesIncompletas.length) {
                const percentComplete = ((ordenesProcesadas / ordenesIncompletas.length) * 100).toFixed(2);
                logger.info(`Procesadas ${ordenesProcesadas}/${ordenesIncompletas.length} órdenes (${percentComplete}%)`);
            }

            // Pausa para respetar las cuotas de la API
            await sleep(500); // Esperar 0.5 segundos
        }
       await corregirCostosProductos()
       await corregirCostosDeEnvio()

        logger.info('Corrección de órdenes incompletas completada.');
    } catch (error) {
        logger.error('Error al corregir órdenes incompletas:', error);
    }
};

// Cache para memoización
const costCache = new Map();

/**
 * Obtiene el costo histórico más cercano a una fecha dada
 * @param {string} sellerSku - seller_sku del producto en la orden
 * @param {Date} date - Fecha de la orden
 */
const getHistoricalCost = async (sellerSku, date) => {
    // Verificar si el seller_sku está en caché
    if (!costCache.has(sellerSku)) {
        // Buscar en ProductCost usando el seller_sku como sku
        const productCost = await ProductCost.findOne({ sku: sellerSku }).lean();
        if (!productCost) return null;
        
        costCache.set(sellerSku, {
            currentCost: productCost.current_cost,
            historicalCosts: productCost.historical_costs.sort((a, b) => 
                new Date(b.date) - new Date(a.date))
        });
    }

    const cachedData = costCache.get(sellerSku);
    const orderDate = new Date(date);

    // Buscar el costo histórico más cercano anterior a la fecha
    const historicalCost = cachedData.historicalCosts.find(h => 
        new Date(h.date) <= orderDate);

    return historicalCost ? historicalCost.cost : cachedData.currentCost;
};

/**
 * Actualiza los costos de productos en las órdenes
 */
const updateOrderCosts = async () => {
    const startDate = new Date('2024-09-12');
    const endDate = new Date();
    const batchSize = 200;
    let processed = 0;
    let skippedSkus = new Set();
    let updatedOrders = 0;
    let totalOrders = await Order.countDocuments({
        date_created: { $gte: startDate, $lte: endDate }
    });

    logger.info(`Iniciando actualización de costos para órdenes desde ${startDate.toISOString()} hasta ${endDate.toISOString()}`);
    logger.info(`Total de órdenes a procesar: ${totalOrders}`);

    try {
        let hasMore = true;
        while (hasMore) {
            const orders = await Order.find({
                date_created: { $gte: startDate, $lte: endDate }
            })
            .skip(processed)
            .limit(batchSize)
            .lean();

            if (orders.length === 0) {
                hasMore = false;
                continue;
            }

            const bulkOps = [];
            
            for (const order of orders) {
                if (!order.order_items || !Array.isArray(order.order_items)) {
                    logger.warn(`Orden ${order.order_id}: No tiene items o items no es un array`);
                    continue;
                }

                const itemUpdates = [];
                let orderNeedsUpdate = false;

                for (const item of order.order_items) {
                    if (!item) {
                        logger.warn(`Orden ${order.order_id}: Item es null o undefined`);
                        continue;
                    }

                    if (!item.seller_sku) {
                        logger.warn(`Orden ${order.order_id}: Item sin seller_sku`);
                        continue;
                    }

                    const cost = await getHistoricalCost(item.seller_sku, order.date_created);
                    
                    if (cost === null) {
                        skippedSkus.add(item.seller_sku);
                        continue;
                    }

                    if (item.product_cost !== cost) {
                        orderNeedsUpdate = true;
                        itemUpdates.push({
                            sku: item.seller_sku,
                            cost: cost
                        });
                    }
                }

                if (orderNeedsUpdate && itemUpdates.length > 0) {
                    const setUpdates = {};
                    const arrayFilters = [];

                    itemUpdates.forEach((update, index) => {
                        const identifier = `elem${index}`;
                        setUpdates[`order_items.$[${identifier}].product_cost`] = update.cost;
                        arrayFilters.push({ [`${identifier}.seller_sku`]: update.sku });
                    });

                    bulkOps.push({
                        updateOne: {
                            filter: { order_id: order.order_id },
                            update: { $set: setUpdates },
                            arrayFilters: arrayFilters
                        }
                    });

                    logger.debug(`Preparando actualización para orden ${order.order_id} con ${itemUpdates.length} items`);
                }
            }

            if (bulkOps.length > 0) {
                logger.info(`Ejecutando batch de ${bulkOps.length} actualizaciones...`);
                const result = await Order.bulkWrite(bulkOps);
                updatedOrders += result.modifiedCount;
                logger.info(`Batch procesado: ${bulkOps.length} órdenes actualizadas`);
            }

            processed += orders.length;
            const progress = ((processed / totalOrders) * 100).toFixed(2);
            logger.info(`Progreso: ${progress}% (${processed}/${totalOrders})`);
        }

        logger.info('=== Reporte de Actualización de Costos ===');
        logger.info(`Total de órdenes procesadas: ${processed}`);
        logger.info(`Órdenes actualizadas: ${updatedOrders}`);
        logger.info(`SKUs no encontrados: ${skippedSkus.size}`);
        if (skippedSkus.size > 0) {
            logger.info('Lista de SKUs no encontrados:');
            Array.from(skippedSkus).forEach(sku => logger.info(`- ${sku}`));
        }

    } catch (error) {
        logger.error('Error durante la actualización de costos:', error);
        throw error;
    }
};

/**
 * Corrige los costos de envío de las órdenes de los últimos 180 días
 */
const corregirCostosEnvioUltimos180Dias = async () => {
    try {
        // Calcular la fecha de hace 180 días
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - 180);

        logger.info(`Iniciando corrección de costos de envío desde ${fechaLimite.toISOString()}`);

        // Obtener todas las órdenes de los últimos 180 días que tengan shipping_id
        const ordenes = await Order.find({
            date_created: { $gte: fechaLimite },
            shipping_id: { $exists: true, $ne: null }
        }).select('shipping_id order_id shipping_cost date_created').lean();

        if (ordenes.length === 0) {
            logger.info('No se encontraron órdenes para procesar.');
            return;
        }

        logger.info(`Se encontraron ${ordenes.length} órdenes para procesar.`);

        // Primer paso: Actualizar costos desde la API
        let processedShippings = 0;
        const totalShippings = ordenes.length;
        const batchSize = 50;
        const bulkOps = [];

        for (let i = 0; i < ordenes.length; i += batchSize) {
            const batch = ordenes.slice(i, Math.min(i + batchSize, ordenes.length));
            
            for (const orden of batch) {
                try {
                    const response = await meliRequest(`shipments/${orden.shipping_id}`);

                    if (response.success && response.data.shipping_option) {
                        const totalCost = response.data.shipping_option.list_cost || 0;
                        const clientCost = response.data.shipping_option.cost || 0;
                        const realShippingCost = totalCost - clientCost;

                        if (orden.shipping_cost !== realShippingCost) {
                            bulkOps.push({
                                updateOne: {
                                    filter: { order_id: orden.order_id },
                                    update: { $set: { shipping_cost: realShippingCost } }
                                }
                            });
                        }
                    }

                    processedShippings++;
                    if (processedShippings % 10 === 0) {
                        logger.info(`Progreso actualización inicial: ${processedShippings}/${totalShippings} (${((processedShippings/totalShippings)*100).toFixed(2)}%)`);
                    }

                } catch (error) {
                    logger.error(`Error procesando orden ${orden.order_id}:`, error);
                }
                await sleep(100);
            }

            if (bulkOps.length > 0) {
                await Order.bulkWrite(bulkOps);
                bulkOps.length = 0;
            }
            await sleep(100);
        }

        // Segundo paso: Distribuir costos para órdenes compartidas
        logger.info('Iniciando distribución de costos para órdenes con shipping_id compartido...');

        const shippingGroups = await Order.aggregate([
            {
                $match: {
                    date_created: { $gte: fechaLimite },
                    shipping_id: { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: "$shipping_id",
                    totalShippingCost: { $sum: "$shipping_cost" },
                    count: { $sum: 1 },
                    orders: { $push: { order_id: "$order_id", shipping_cost: "$shipping_cost" } }
                }
            },
            {
                $match: {
                    count: { $gte: 2 }
                }
            }
        ]);

        logger.info(`Se encontraron ${shippingGroups.length} grupos de órdenes para distribuir costos.`);

        for (const group of shippingGroups) {
            const { _id: shippingId, totalShippingCost, count, orders } = group;
            const shippingCostPerDoc = totalShippingCost / count;

            await Order.updateMany(
                { shipping_id: shippingId },
                { $set: { shipping_cost: shippingCostPerDoc } }
            );

            logger.info(`Shipping ID ${shippingId}:`);
            logger.info(`- Costo total: $${totalShippingCost.toFixed(2)}`);
            logger.info(`- Órdenes afectadas: ${count}`);
            logger.info(`- Costo distribuido por orden: $${shippingCostPerDoc.toFixed(2)}`);
            logger.info(`- Order IDs: ${orders.map(o => o.order_id).join(', ')}`);
        }

        logger.info('=== Reporte Final ===');
        logger.info(`Total de órdenes procesadas: ${processedShippings}`);
        logger.info(`Grupos de órdenes con costos distribuidos: ${shippingGroups.length}`);
        logger.info(`Proceso completado exitosamente.`);

    } catch (error) {
        logger.error('Error general en la corrección de costos de envío:', error);
        throw error;
    }
};

// Exportar las funciones
module.exports = { 
    processPending, 
    resetOrdersAndNotifications,
    initializeLastYearOrders,
    saveOrUpdateOrders,
    corregirCostosDeEnvio,
    corregirCostosProductos, // Nueva función exportada
    distributeShippingCost,
    completarOrdenesIncompletas,
    updateOrderCosts,
    corregirCostosEnvioUltimos180Dias
};
