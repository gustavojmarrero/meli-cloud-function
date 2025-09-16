// controllers/catalogController.js
const AsinCatalogMapping = require('../models/asinCatalogMapping');
const { meliRequest } = require('../config/meliconfig');
const logger = require('../config/logger');

const DEFAULT_SELLER_ID = 397528431;
const DEFAULT_ZIP_CODE = '01000';

const getReferenceItemId = (catalogMapping) => {
    if (catalogMapping.mlm?.itemId) {
        return catalogMapping.mlm.itemId;
    }
    if (Array.isArray(catalogMapping.itemIds) && catalogMapping.itemIds.length > 0) {
        return catalogMapping.itemIds[catalogMapping.itemIds.length - 1];
    }
    if (catalogMapping.mlItemId) {
        return catalogMapping.mlItemId;
    }
    return null;
};

const fetchLatestShippingCost = async (catalogMapping) => {
    const result = {
        shippingCost: catalogMapping.mlShippingCost,
        sellerId: DEFAULT_SELLER_ID
    };

    const referenceItemId = getReferenceItemId(catalogMapping);
    if (!referenceItemId) {
        logger.warn(`No hay itemId de referencia para ${catalogMapping.mlCatalogId}, se usarán costos almacenados.`);
        return result;
    }

    let sellerId = DEFAULT_SELLER_ID;

    try {
        const itemRes = await meliRequest(`items/${referenceItemId}`);
        if (itemRes.success && itemRes.data?.seller_id) {
            sellerId = itemRes.data.seller_id;
        } else if (!itemRes.success) {
            logger.warn(`No se pudo obtener seller_id para ${referenceItemId}: ${itemRes.error}`);
        }
    } catch (error) {
        logger.error(`Error al obtener datos del item ${referenceItemId}:`, error.message || error);
    }

    try {
        const shippingRes = await meliRequest(
            `users/${sellerId}/shipping_options/free`,
            'GET',
            null,
            {
                params: {
                    item_id: referenceItemId,
                    zip_code: DEFAULT_ZIP_CODE,
                    verbose: true
                }
            }
        );

        if (shippingRes.success) {
            const listCost = Number(shippingRes.data?.coverage?.all_country?.list_cost);
            if (!Number.isNaN(listCost)) {
                result.shippingCost = listCost;
            }
        } else {
            logger.warn(`No se pudo obtener costo de envío para ${referenceItemId}: ${shippingRes.error}`);
        }
    } catch (error) {
        logger.error('Error al consultar costos de envío:', error.message || error);
    }

    result.sellerId = sellerId;
    return result;
};

const fetchLatestSaleCommission = async (categoryId, priceForQuery, fallbackCommission) => {
    let commission = fallbackCommission;

    try {
        const commissionRes = await meliRequest(
            'sites/MLM/listing_prices',
            'GET',
            null,
            {
                params: {
                    price: priceForQuery,
                    listing_type_id: 'gold_special',
                    category_id: categoryId
                }
            }
        );

        if (commissionRes.success) {
            const percentageFee = Number(commissionRes.data?.sale_fee_details?.percentage_fee);
            if (!Number.isNaN(percentageFee)) {
                commission = Number((percentageFee / 100).toFixed(6));
            }
        } else {
            logger.warn(`No se pudo obtener comisión actualizada: ${commissionRes.error}`);
        }
    } catch (error) {
        logger.error('Error al consultar comisión en MercadoLibre:', error.message || error);
    }

    return commission;
};

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

        const { shippingCost: latestShippingCost } = await fetchLatestShippingCost(catalogMapping);
        const priceForCommission = catalogMapping.firstListingPrice || catalogMapping.amazonPrice || 100;
        const latestSaleCommission = await fetchLatestSaleCommission(
            catalogMapping.mlCategoryId,
            priceForCommission,
            catalogMapping.mlSaleCommission
        );

        // Calcular el precio según las reglas del PRD
        let price;
        if (catalogMapping.firstListingPrice && catalogMapping.firstListingPrice > 0) {
            price = catalogMapping.firstListingPrice;
            logger.info(`Usando firstListingPrice: ${price}`);
        } else {
            const amazonPrice = catalogMapping.amazonPrice;
            const shippingForPrice = typeof latestShippingCost === 'number' ? latestShippingCost : catalogMapping.mlShippingCost;
            const commissionForPrice = typeof latestSaleCommission === 'number' ? latestSaleCommission : catalogMapping.mlSaleCommission;

            price = Math.ceil((amazonPrice + shippingForPrice + 200) / (1 - commissionForPrice));
            logger.info(`Precio calculado: ${price} (Amazon: ${amazonPrice}, Envío: ${shippingForPrice}, Comisión: ${commissionForPrice})`);
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

        const { id: itemId, title, permalink } = response.data;

        logger.info(`Publicación creada exitosamente. ItemId: ${itemId}`);

        const updatedShippingCost = latestShippingCost;
        const updatedSaleCommission = latestSaleCommission;
        const mlmData = {
            itemId,
            shippingCost: typeof updatedShippingCost === 'number' ? updatedShippingCost : catalogMapping.mlShippingCost,
            saleCommission: typeof updatedSaleCommission === 'number' ? updatedSaleCommission : catalogMapping.mlSaleCommission
        };

        // Actualizar la base de datos con la información de la publicación
        await AsinCatalogMapping.findOneAndUpdate(
            { mlCatalogId },
            {
                $set: {
                    mlItemId: itemId,
                    lastPublishedAt: new Date(),
                    sku: sku,
                    mlm: mlmData
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
            costUpdates['mlm.shippingCost'] = updatedShippingCost;
        }
        if (typeof updatedSaleCommission === 'number' && Math.abs(updatedSaleCommission - catalogMapping.mlSaleCommission) > 0.0001) {
            costUpdates.mlSaleCommission = updatedSaleCommission;
            costUpdates['mlm.saleCommission'] = updatedSaleCommission;
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
                mlSaleCommission: 1,
                mlm: 1
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
