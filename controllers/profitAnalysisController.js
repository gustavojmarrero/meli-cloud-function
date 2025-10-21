// controllers/profitAnalysisController.js

const { updateSheet, readSheet, clearSheet } = require('../config/googleSheetsConfig');
const Order = require('../models/meliOrder');
const PurchaseControl = require('../models/purchaseControl');
const logger = require('../config/logger');

// ID del archivo de Google Sheets para análisis de ganancias
const PROFIT_SHEET_ID = '1PKFCSNVsRR8wM6mOeckoJUYGqKrZ9oWrbvSf_7FHLD8';
const INPUT_SHEET_NAME = 'Lista';
const OUTPUT_SHEET_NAME = 'GananciaTop50';

// Configuración desde variables de entorno
const TOP_LIMIT = parseInt(process.env.TOP_PROFIT_LIMIT) || 50;
const ANALYSIS_DAYS = parseInt(process.env.PROFIT_ANALYSIS_DAYS) || 180;
const COST_ANALYSIS_DAYS = parseInt(process.env.COST_ANALYSIS_DAYS) || 365;

/**
 * Calcula la moda usando rangos dinámicos de ±5%
 * 1. Para cada precio único, cuenta cuántos precios totales caen en su rango [precio*0.95, precio*1.05]
 * 2. El rango con mayor densidad es el cluster modal
 * 3. En caso de empate, usa el cluster con precio mínimo más bajo
 * 4. Retorna el precio más bajo del cluster modal
 */
const calcularModaConRangoDinamico = (valores, porcentaje = 0.05) => {
    if (valores.length === 0) return 0;
    if (valores.length === 1) return valores[0];

    // Obtener precios únicos como centros candidatos
    const preciosUnicos = [...new Set(valores)].sort((a, b) => a - b);

    let maxDensidad = 0;
    let precioMinimoModal = Infinity;

    // Para cada precio único, calcular densidad en su rango ±5%
    preciosUnicos.forEach(precioCenter => {
        const rangoMin = precioCenter * (1 - porcentaje);
        const rangoMax = precioCenter * (1 + porcentaje);

        // Contar precios totales en este rango
        const preciosEnRango = valores.filter(p => p >= rangoMin && p <= rangoMax);
        const densidad = preciosEnRango.length;
        const precioMinimo = Math.min(...preciosEnRango);

        // Actualizar si encontramos mayor densidad o misma densidad con precio menor
        if (densidad > maxDensidad ||
            (densidad === maxDensidad && precioMinimo < precioMinimoModal)) {
            maxDensidad = densidad;
            precioMinimoModal = precioMinimo;
        }
    });

    return precioMinimoModal;
};

/**
 * Obtiene y exporta el TOP de SKUs por ganancia a Google Sheets.
 */
const getTopProfitSkus = async (req, res) => {
    try {
        logger.info(`Iniciando análisis de TOP ${TOP_LIMIT} SKUs por ganancia de los últimos ${ANALYSIS_DAYS} días.`);

        // 1. Leer SKUs y ASINs desde Google Sheets (columnas B y D)
        logger.info('Leyendo SKUs y ASINs desde Google Sheets...');
        const sheetData = await readSheet(PROFIT_SHEET_ID, `${INPUT_SHEET_NAME}!B2:D`);

        if (!sheetData || sheetData.length === 0) {
            logger.warn('No se encontraron datos en la hoja Lista.');
            return res.status(200).json({ message: 'No se encontraron datos en la hoja Lista.' });
        }

        // Crear Map de SKU -> ASIN y lista de SKUs únicos
        const skuToAsinMap = new Map();
        const asinToSkuMap = new Map();

        sheetData.forEach(row => {
            const sku = row[0] ? String(row[0]).trim() : '';
            const asin = row[2] ? String(row[2]).trim() : ''; // Columna D está en índice 2

            if (sku) {
                skuToAsinMap.set(sku, asin);
                if (asin) {
                    asinToSkuMap.set(asin, sku);
                }
            }
        });

        const skus = Array.from(skuToAsinMap.keys()).filter(sku => sku !== '');
        logger.info(`SKUs únicos encontrados: ${skus.length}`);

        // 2. Calcular fecha límite
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() - ANALYSIS_DAYS);

        // 3. Calcular fecha límite para análisis de costos
        const fechaLimiteCostos = new Date();
        fechaLimiteCostos.setDate(fechaLimiteCostos.getDate() - COST_ANALYSIS_DAYS);

        // 4. Obtener costos medios por ASIN
        logger.info('Calculando costos medios por ASIN...');
        const costoMedioPorAsin = new Map();

        // Obtener ASINs únicos
        const asinsUnicos = [...new Set(Array.from(skuToAsinMap.values()).filter(asin => asin !== ''))];

        for (const asin of asinsUnicos) {
            const compras = await PurchaseControl.find({
                asin: asin,
                fecha: { $gte: fechaLimiteCostos },
                pDdescuento: { $exists: true, $ne: null, $gt: 0 }
            }).exec();

            if (compras.length > 0) {
                const precios = compras.map(c => parseFloat(c.pDdescuento));
                const moda = calcularModaConRangoDinamico(precios);
                costoMedioPorAsin.set(asin, moda);
                logger.info(`ASIN ${asin}: ${compras.length} compras, costo modal (±5%) = $${moda.toFixed(2)}`);
            }
        }

        // 5. Objeto para almacenar ganancias por SKU
        const gananciasPorSku = {};

        // Inicializar todos los SKUs con ganancia 0
        skus.forEach(sku => {
            const asin = skuToAsinMap.get(sku) || '';
            gananciasPorSku[sku] = {
                sku: sku,
                asin: asin,
                gananciaTotal: 0,
                costoMedio: costoMedioPorAsin.get(asin) || 0
            };
        });

        // 4. Procesar cada SKU
        logger.info('Procesando órdenes por SKU...');

        for (const sku of skus) {
            // Obtener órdenes que contengan este SKU en los últimos N días
            const orders = await Order.find({
                status: 'paid',
                date_created: { $gte: fechaLimite },
                'order_items.seller_sku': sku
            }).exec();

            // Calcular ganancia total para este SKU
            orders.forEach(order => {
                order.order_items.forEach(item => {
                    // Solo procesar items que coincidan con el SKU actual
                    if (item.seller_sku === sku) {
                        // Aplicar la misma fórmula que en salesExportController.js línea 63
                        const precioAcumulado = parseFloat((item.quantity * parseFloat(item.unit_price)) / 1.16);
                        const costoAcum = parseFloat(item.product_cost || 0) * item.quantity;
                        const comisionVta = parseFloat((item.sale_fee * item.quantity) || 0) / 1.16;
                        const comisionEnvio = parseFloat(order.shipping_cost || 0) / 1.16;

                        const ganancia = precioAcumulado - costoAcum - comisionVta - comisionEnvio;

                        gananciasPorSku[sku].gananciaTotal += ganancia;
                    }
                });
            });

            logger.info(`SKU ${sku}: Ganancia total = $${gananciasPorSku[sku].gananciaTotal.toFixed(2)}`);
        }

        // 5. Convertir a array, filtrar y ordenar
        const resultados = Object.values(gananciasPorSku)
            .filter(item => item.gananciaTotal > 0) // Solo SKUs con ganancia positiva
            .sort((a, b) => b.gananciaTotal - a.gananciaTotal) // Ordenar descendente
            .slice(0, TOP_LIMIT); // Tomar TOP N

        logger.info(`SKUs con ganancia positiva: ${resultados.length}`);

        if (resultados.length === 0) {
            logger.info('No se encontraron SKUs con ganancia positiva.');
            return res.status(200).json({ message: 'No se encontraron SKUs con ganancia positiva.' });
        }

        // 6. Preparar datos para exportación
        const rows = resultados.map(item => [
            item.sku,
            item.asin,
            parseFloat(item.gananciaTotal).toFixed(2),
            parseFloat(item.costoMedio).toFixed(2)
        ]);

        // 7. Exportar a Google Sheets
        logger.info('Exportando resultados a Google Sheets...');

        // Limpiar hoja completa
        await clearSheet(PROFIT_SHEET_ID, `${OUTPUT_SHEET_NAME}!A1:D`);

        // Escribir encabezados
        await updateSheet(PROFIT_SHEET_ID, `${OUTPUT_SHEET_NAME}!A1`, [['SKU', 'ASIN', 'Ganancia', 'Costo Medio']]);

        // Escribir datos
        await updateSheet(PROFIT_SHEET_ID, `${OUTPUT_SHEET_NAME}!A2`, rows);

        logger.info(`Exportación completada: TOP ${resultados.length} SKUs exportados.`);
        return res.status(200).json({
            message: `Exportación completada: TOP ${resultados.length} SKUs exportados.`,
            totalSkusAnalizados: skus.length,
            skusConGanancia: resultados.length,
            topSkus: resultados.slice(0, 10).map(r => ({
                sku: r.sku,
                asin: r.asin,
                ganancia: r.gananciaTotal.toFixed(2),
                costoMedio: r.costoMedio.toFixed(2)
            }))
        });

    } catch (error) {
        logger.error('Error al obtener TOP ganancias por SKU:', error);
        return res.status(500).json({ error: 'Error al obtener TOP ganancias por SKU.' });
    }
};

module.exports = { getTopProfitSkus };
