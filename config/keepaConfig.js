// config/keepaConfig.js
const axios = require('axios');
const logger = require('./logger');

const KEEPA_API_URL = 'https://api.keepa.com/product';
const KEEPA_DOMAIN_MX = 11; // Amazon México

// Valores por defecto si Keepa no tiene datos (17x14x14 cm, 1 kg)
const DEFAULT_DIMENSIONS = {
    height: 17,   // cm
    width: 14,    // cm
    length: 14,   // cm
    weight: 1000  // gramos (1 kg)
};

/**
 * Obtiene las dimensiones del paquete desde Keepa API
 * @param {string} asin - ASIN del producto en Amazon
 * @returns {Object} - { height, width, length, weight } en cm y gramos
 */
const getProductDimensions = async (asin) => {
    const accessKey = process.env.KEEPA_ACCESS_KEY;

    if (!accessKey) {
        logger.warn('KEEPA_ACCESS_KEY no configurada, usando dimensiones por defecto');
        return DEFAULT_DIMENSIONS;
    }

    if (!asin) {
        logger.warn('ASIN no proporcionado, usando dimensiones por defecto');
        return DEFAULT_DIMENSIONS;
    }

    try {
        logger.info(`Consultando dimensiones en Keepa para ASIN: ${asin}`);

        const response = await axios.get(KEEPA_API_URL, {
            params: {
                key: accessKey,
                domain: KEEPA_DOMAIN_MX,
                asin: asin
            },
            timeout: 10000
        });

        if (!response.data || !response.data.products || response.data.products.length === 0) {
            logger.warn(`Keepa no tiene datos para ASIN: ${asin}, usando dimensiones por defecto`);
            return DEFAULT_DIMENSIONS;
        }

        const product = response.data.products[0];

        // Keepa devuelve dimensiones en mm*10 (centímetros*100) y peso en gramos
        // packageHeight/Width/Length están en unidades de 1/100 cm = 0.1mm
        // Dividimos entre 10 para obtener cm
        // Obtener dimensiones de Keepa
        const keepaHeight = product.packageHeight ? Math.round(product.packageHeight / 10) : 0;
        const keepaWidth = product.packageWidth ? Math.round(product.packageWidth / 10) : 0;
        const keepaLength = product.packageLength ? Math.round(product.packageLength / 10) : 0;
        const keepaWeight = product.packageWeight || 0;

        // Usar el mayor entre Keepa y default para evitar errores de ML
        const dimensions = {
            height: Math.max(keepaHeight, DEFAULT_DIMENSIONS.height),
            width: Math.max(keepaWidth, DEFAULT_DIMENSIONS.width),
            length: Math.max(keepaLength, DEFAULT_DIMENSIONS.length),
            weight: Math.max(keepaWeight, DEFAULT_DIMENSIONS.weight)
        };

        logger.info(`Dimensiones Keepa: ${keepaLength}x${keepaWidth}x${keepaHeight} cm, ${keepaWeight}g`);
        logger.info(`Dimensiones finales (max con default): ${dimensions.length}x${dimensions.width}x${dimensions.height} cm, ${dimensions.weight}g`);

        return dimensions;

    } catch (error) {
        logger.error(`Error al consultar Keepa para ASIN ${asin}:`, error.message);
        return DEFAULT_DIMENSIONS;
    }
};

module.exports = {
    getProductDimensions,
    DEFAULT_DIMENSIONS
};
