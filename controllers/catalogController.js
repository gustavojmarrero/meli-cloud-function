// controllers/catalogController.js
const AsinCatalogMapping = require('../models/asinCatalogMapping');
const { meliRequest } = require('../config/meliconfig');
const logger = require('../config/logger');

/**
 * Publica un producto en el catálogo de MercadoLibre
 * @param {Object} req - Request con mlCatalogId y sku
 * @param {Object} res - Response
 */
const publishToCatalog = async (req, res) => {
    try {
        const { mlCatalogId, sku } = req.body;

        // Validar datos de entrada
        if (!mlCatalogId || !sku) {
            logger.error('Faltan parámetros requeridos: mlCatalogId o sku');
            return res.status(400).json({
                success: false,
                error: 'mlCatalogId y sku son requeridos'
            });
        }

        logger.info(`Iniciando publicación para mlCatalogId: ${mlCatalogId}, sku: ${sku}`);

        // Buscar datos del mapeo en la base de datos
        const catalogMapping = await AsinCatalogMapping.findOne({ mlCatalogId });

        if (!catalogMapping) {
            logger.error(`No se encontró mapeo para mlCatalogId: ${mlCatalogId}`);
            return res.status(404).json({
                success: false,
                error: `No se encontró información para el catalog ID: ${mlCatalogId}`
            });
        }

        // Calcular el precio según las reglas del PRD
        let price;
        if (catalogMapping.firstListingPrice && catalogMapping.firstListingPrice > 0) {
            price = catalogMapping.firstListingPrice;
            logger.info(`Usando firstListingPrice: ${price}`);
        } else {
            // Fórmula: Math.ceil((amazonPrice + mlShippingCost + 200) / (1 - mlSaleCommission))
            const { amazonPrice, mlShippingCost, mlSaleCommission } = catalogMapping;
            price = Math.ceil((amazonPrice + mlShippingCost + 200) / (1 - mlSaleCommission));
            logger.info(`Precio calculado: ${price} (Amazon: ${amazonPrice}, Envío: ${mlShippingCost}, Comisión: ${mlSaleCommission})`);
        }

        // Construir el payload exacto según el PRD
        const payload = {
            site_id: "MLM",
            category_id: catalogMapping.mlCategoryId,
            official_store_id: 145264,
            price: price,
            currency_id: "MXN",
            available_quantity: 0,
            buying_mode: "buy_it_now",
            listing_type_id: "gold_special",
            attributes: [
                {
                    id: "SELLER_SKU",
                    value_name: sku
                },
                {
                    id: "ITEM_CONDITION",
                    value_id: "2230284"
                }
            ],
            catalog_product_id: mlCatalogId,
            catalog_listing: true
        };

        logger.info('Enviando solicitud a MercadoLibre API');

        // Realizar la publicación en MercadoLibre
        const response = await meliRequest('items', 'POST', payload);

        if (!response.success) {
            logger.error(`Error en la API de MercadoLibre: ${response.error}`);
            return res.status(400).json({
                success: false,
                error: response.error || 'Error al crear la publicación en MercadoLibre'
            });
        }

        const { id: itemId, title, permalink, seller_id: apiSellerId } = response.data;

        logger.info(`Publicación creada exitosamente. ItemId: ${itemId}`);

        // Calcular costos reales de envío y comisión obtenidos desde la API de ML
        let updatedShippingCost = catalogMapping.mlShippingCost;
        let updatedSaleCommission = catalogMapping.mlSaleCommission;

        const sellerId = apiSellerId || 397528431;

        try {
            const shippingRes = await meliRequest(
                `users/${sellerId}/shipping_options/free`,
                'GET',
                null,
                {
                    params: {
                        item_id: itemId,
                        zip_code: '01000',
                        verbose: true
                    }
                }
            );

            if (shippingRes.success) {
                const listCost = shippingRes.data?.coverage?.all_country?.list_cost;
                const parsedCost = Number(listCost);
                if (!Number.isNaN(parsedCost)) {
                    updatedShippingCost = parsedCost;
                }
            } else {
                logger.warn(`No se pudo obtener el costo de envío actualizado: ${shippingRes.error}`);
            }
        } catch (shippingError) {
            logger.error('Error al consultar costo de envío en MercadoLibre:', shippingError.message || shippingError);
        }

        try {
            const commissionRes = await meliRequest(
                'sites/MLM/listing_prices',
                'GET',
                null,
                {
                    params: {
                        price: price,
                        listing_type_id: 'gold_special',
                        category_id: catalogMapping.mlCategoryId
                    }
                }
            );

            if (commissionRes.success) {
                const saleFeeAmount = Number(commissionRes.data?.sale_fee_amount);
                if (!Number.isNaN(saleFeeAmount) && price > 0) {
                    updatedSaleCommission = Number((saleFeeAmount / price).toFixed(6));
                }
            } else {
                logger.warn(`No se pudo obtener la comisión actualizada: ${commissionRes.error}`);
            }
        } catch (commissionError) {
            logger.error('Error al consultar comisión en MercadoLibre:', commissionError.message || commissionError);
        }

        // Actualizar la base de datos con la información de la publicación
        await AsinCatalogMapping.findOneAndUpdate(
            { mlCatalogId },
            {
                $set: {
                    mlItemId: itemId,
                    lastPublishedAt: new Date(),
                    sku: sku
                },
                $addToSet: {
                    itemIds: itemId
                }
            },
            { new: true }
        );

        logger.info(`Base de datos actualizada para mlCatalogId: ${mlCatalogId}`);

        // Sincronizar costos si difieren de lo almacenado
        const costUpdates = {};
        if (typeof updatedShippingCost === 'number' && Math.abs(updatedShippingCost - catalogMapping.mlShippingCost) > 0.01) {
            costUpdates.mlShippingCost = updatedShippingCost;
        }
        if (typeof updatedSaleCommission === 'number' && Math.abs(updatedSaleCommission - catalogMapping.mlSaleCommission) > 0.0001) {
            costUpdates.mlSaleCommission = updatedSaleCommission;
        }

        if (Object.keys(costUpdates).length > 0) {
            await AsinCatalogMapping.updateOne({ mlCatalogId }, { $set: costUpdates });
            logger.info(`Costos actualizados en BD para ${mlCatalogId}: ${JSON.stringify(costUpdates)}`);
        }

        // Preparar respuesta compatible con Google Sheets
        const responseData = {
            success: true,
            data: {
                itemId: itemId,
                title: title || 'Título del producto',
                mlShippingCost: updatedShippingCost,
                mlSaleCommission: updatedSaleCommission,
                permalink: permalink
            }
        };

        logger.info(`Publicación completada exitosamente para SKU: ${sku}`);

        return res.status(201).json(responseData);

    } catch (error) {
        logger.error('Error en publishToCatalog:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno del servidor al procesar la publicación'
        });
    }
};

/**
 * Obtiene el estado de una publicación
 * @param {Object} req - Request con itemId
 * @param {Object} res - Response
 */
const getListingStatus = async (req, res) => {
    try {
        const { itemId } = req.params;

        if (!itemId) {
            return res.status(400).json({
                success: false,
                error: 'itemId es requerido'
            });
        }

        logger.info(`Consultando estado de la publicación: ${itemId}`);

        // Consultar el estado en MercadoLibre
        const response = await meliRequest(`items/${itemId}`, 'GET');

        if (!response.success) {
            logger.error(`Error al consultar el item: ${response.error}`);
            return res.status(404).json({
                success: false,
                error: 'No se pudo obtener información de la publicación'
            });
        }

        const { status, sub_status, available_quantity, price, title } = response.data;

        return res.status(200).json({
            success: true,
            data: {
                itemId,
                title,
                status,
                sub_status,
                available_quantity,
                price
            }
        });

    } catch (error) {
        logger.error('Error en getListingStatus:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
};

/**
 * Lista todas las publicaciones de catálogo creadas
 * @param {Object} req - Request
 * @param {Object} res - Response
 */
const getListings = async (req, res) => {
    try {
        const { limit = 50, skip = 0 } = req.query;

        const listings = await AsinCatalogMapping.find(
            { mlItemId: { $ne: null } },
            {
                mlCatalogId: 1,
                mlItemId: 1,
                sku: 1,
                lastPublishedAt: 1,
                amazonPrice: 1,
                mlShippingCost: 1,
                mlSaleCommission: 1
            }
        )
        .limit(parseInt(limit))
        .skip(parseInt(skip))
        .sort({ lastPublishedAt: -1 });

        const total = await AsinCatalogMapping.countDocuments({ mlItemId: { $ne: null } });

        return res.status(200).json({
            success: true,
            data: {
                listings,
                total,
                limit: parseInt(limit),
                skip: parseInt(skip)
            }
        });

    } catch (error) {
        logger.error('Error en getListings:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
};

module.exports = {
    publishToCatalog,
    getListingStatus,
    getListings
};
