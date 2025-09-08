// controllers/productCostController.js

const ProductCost = require('../models/productCost');
const {
    readSheet,
    listGoogleSheetsInFolder,
} = require('../config/googleSheetsConfig');
const logger = require('../config/logger');
require('dotenv').config();

// Agregar al inicio del archivo o antes de getHistoricalCosts
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función principal para inicializar los costos de los productos
const initializeProductCosts = async (startDate = null) => {
    try {
        const startTime = Date.now();

        // Paso 1: Eliminar todos los documentos de la colección productCosts
        await ProductCost.deleteMany({});
        logger.info('Todos los documentos de la colección productCosts han sido eliminados.');

        // Paso 2: Leer el mapeo SKU-ASIN desde el archivo de mapeo
        const skuAsinMap = await getSkuAsinMap();
        logger.info(`Se han obtenido ${skuAsinMap.size} pares SKU-ASIN del archivo de mapeo.`);

        // Paso 3: Obtener el costo actual para cada SKU
        const currentCosts = await getCurrentCosts(skuAsinMap);
        logger.info(`Se han obtenido costos actuales para ${currentCosts.size} SKUs.`);

        // Paso 4: Obtener los costos históricos para cada SKU a partir de la fecha especificada
        const historicalCostsMap = await getHistoricalCosts(skuAsinMap, startDate);
        logger.info('Se han obtenido los costos históricos para los SKUs.');

        // Paso 5: Construir y almacenar los documentos en productCosts
        const bulkOps = [];
        const totalSKUs = skuAsinMap.size;
        let processedSKUs = 0;

        for (const [sku, asin] of skuAsinMap.entries()) {
            const current_cost = currentCosts.get(sku) || 0;
            const historical_costs = historicalCostsMap.get(sku) || [];

            bulkOps.push({
                insertOne: {
                    document: {
                        sku,
                        current_cost,
                        historical_costs,
                    },
                },
            });

            processedSKUs++;
            if (processedSKUs % 100 === 0 || processedSKUs === totalSKUs) {
                const percentComplete = ((processedSKUs / totalSKUs) * 100).toFixed(2);
                logger.info(`Construidos ${processedSKUs}/${totalSKUs} documentos (${percentComplete}%)`);
            }
        }

        if (bulkOps.length > 0) {
            logger.info(`Iniciando inserción de ${bulkOps.length} documentos en la colección productCosts.`);
            const insertStartTime = Date.now();
            await ProductCost.bulkWrite(bulkOps);
            const insertEndTime = Date.now();
            const insertTime = ((insertEndTime - insertStartTime) / 1000).toFixed(2);
            logger.info(`Se han insertado ${bulkOps.length} documentos en la colección productCosts en ${insertTime} segundos.`);
        } else {
            logger.warn('No se han encontrado SKUs para insertar en la colección productCosts.');
        }

        const endTime = Date.now();
        const totalTime = ((endTime - startTime) / 1000).toFixed(2);
        logger.info(`Inicialización de costos completada en ${totalTime} segundos.`);
    } catch (error) {
        logger.error('Error al inicializar los costos de los productos', { error });
        throw error;
    }
};

// Función para actualizar los costos actuales y los históricos si hay cambios
const updateProductCosts = async () => {
    try {
        logger.info('Iniciando actualización diaria de costos de productos.');

        const startTime = Date.now();

        // Paso 1: Obtener el mapeo SKU-ASIN
        const skuAsinMap = await getSkuAsinMap();
        logger.info(`Se han obtenido ${skuAsinMap.size} pares SKU-ASIN del archivo de mapeo.`);

        // Paso 2: Obtener el costo actual para cada SKU
        const currentCosts = await getCurrentCosts(skuAsinMap);
        logger.info(`Se han obtenido costos actuales para ${currentCosts.size} SKUs.`);

        // Paso 3: Obtener los costos históricos más recientes almacenados
        const existingCosts = await ProductCost.find({});
        const existingCostsMap = new Map();
        existingCosts.forEach(doc => {
            existingCostsMap.set(doc.sku, doc);
        });

        const bulkOps = [];
        let updatedSKUs = 0;

        for (const [sku, asin] of skuAsinMap.entries()) {
            const newCost = currentCosts.get(sku) || 0;
            const product = existingCostsMap.get(sku);

            if (product) {
                const lastHistoricalCost = product.historical_costs[product.historical_costs.length - 1];

                // Verificar si el costo actual ha cambiado
                if (lastHistoricalCost && lastHistoricalCost.cost !== newCost) {
                    // Actualizar current_cost y agregar al histórico
                    bulkOps.push({
                        updateOne: {
                            filter: { sku },
                            update: {
                                $set: { current_cost: newCost },
                                $push: { historical_costs: { date: new Date(), cost: newCost } },
                            },
                        },
                    });
                    updatedSKUs++;
                }
            } else {
                // Si el SKU no existe, crear uno nuevo
                bulkOps.push({
                    insertOne: {
                        document: {
                            sku,
                            current_cost: newCost,
                            historical_costs: [{ date: new Date(), cost: newCost }],
                        },
                    },
                });
                updatedSKUs++;
            }
        }

        if (bulkOps.length > 0) {
            logger.info(`Iniciando actualización/inserción de ${bulkOps.length} documentos en la colección productCosts.`);
            const insertStartTime = Date.now();
            await ProductCost.bulkWrite(bulkOps);
            const insertEndTime = Date.now();
            const insertTime = ((insertEndTime - insertStartTime) / 1000).toFixed(2);
            logger.info(`Se han actualizado/insertado ${bulkOps.length} documentos en la colección productCosts en ${insertTime} segundos.`);
        } else {
            logger.info('No se detectaron cambios en los costos actuales. No se realizaron actualizaciones.');
        }

        const endTime = Date.now();
        const totalTime = ((endTime - startTime) / 1000).toFixed(2);
        logger.info(`Actualización diaria de costos completada en ${totalTime} segundos. SKUs actualizados: ${updatedSKUs}`);
    } catch (error) {
        logger.error('Error al actualizar los costos de los productos', { error });
    }
};

// Función para leer el mapeo SKU-ASIN desde el archivo de mapeo
const getSkuAsinMap = async () => {
    const mappingSpreadsheetId = '1QTWoQrOCjP7BfuFG3yKnGzQsueGvKaLQr19Fs2AqZqk';
    const mappingSheetName = 'Productos';
    const mappingRange = `${mappingSheetName}!A2:B`;

    const values = await readSheet(mappingSpreadsheetId, mappingRange);

    const skuAsinMap = new Map();

    for (const row of values) {
        const sku = row[0] ? String(row[0]).trim() : null;
        const asin = row[1] ? String(row[1]).trim() : null;

        if (sku && asin) {
            skuAsinMap.set(sku, asin);
        }
    }

    return skuAsinMap;
};

// Función para obtener el costo actual para cada SKU
const getCurrentCosts = async (skuAsinMap) => {
    const spreadsheetId = '1eDRXO9IYi7XX93g-QHOGbrzUFHpJcfVn-LZmGELUXJY';
    const sheetName = 'C';
    const range = `${sheetName}!A2:E`;

    const values = await readSheet(spreadsheetId, range);

    const asinCostMap = new Map();

    for (const row of values) {
        const asin = row[0] ? String(row[0]).trim() : null;
        const costStr = row[4]; // Columna E es índice 4

        if (asin && costStr !== null && costStr !== undefined && costStr !== '') {
            const cleanCostStr = String(costStr).replace(/[^0-9.-]+/g, '');
            const numericCost = parseFloat(cleanCostStr);

            if (!isNaN(numericCost) && numericCost >= 0) {
                asinCostMap.set(asin, numericCost);
            }
        }
    }

    const currentCosts = new Map();

    for (const [sku, asin] of skuAsinMap.entries()) {
        const cost = asinCostMap.get(asin);
        if (cost !== undefined) {
            currentCosts.set(sku, cost);
        }
    }

    return currentCosts;
};

// Función para obtener los costos históricos para cada SKU
const getHistoricalCosts = async (skuAsinMap, startDate) => {
    const folderId = '1GdWrVflgBJ2EaKhUmb6NFNJA59r0-iIj';
    const files = await listGoogleSheetsInFolder(folderId);
    
    // Definir el rango de lectura
    const sheetName = 'C';
    const range = `${sheetName}!A2:E`;
    
    // Crear el mapa inverso de ASIN a SKU
    const asinToSkuMap = new Map();
    for (const [sku, asin] of skuAsinMap.entries()) {
        asinToSkuMap.set(asin, sku);
    }

    const historicalCostsMap = new Map();
    const lastKnownCosts = new Map();

    // Filtrar archivos por fecha
    const filteredFiles = files.filter(file => {
        const dateStr = extractDateFromFileName(file.name);
        if (!dateStr) return false;
        
        const date = new Date(dateStr);
        const start = new Date(startDate);
        const today = new Date();
        
        return date >= start && date <= today;
    });

    // Ordenar archivos por fecha ascendente
    filteredFiles.sort((a, b) => {
        const dateA = new Date(extractDateFromFileName(a.name));
        const dateB = new Date(extractDateFromFileName(b.name));
        return dateA - dateB;
    });

    let processedFiles = 0;
    const totalFiles = filteredFiles.length;

    logger.info(`Se encontraron ${totalFiles} archivos para procesar entre ${startDate} y hoy.`);

    for (const file of filteredFiles) {
        const startTime = Date.now(); // Definimos startTime al inicio de cada iteración
        
        const dateStr = extractDateFromFileName(file.name);
        if (!dateStr) continue;
        
        const fileDate = new Date(dateStr);
        
        try {
            logger.info(`Procesando archivo: ${file.name} con fecha: ${fileDate.toISOString()}`);
            const values = await readSheet(file.id, range);
            
            for (const row of values) {
                const asin = row[0]?.toString().trim();
                const costStr = row[4];
                
                if (!asin || !costStr) continue;
                
                const cleanCostStr = String(costStr).replace(/[^0-9.-]+/g, '');
                const cost = parseFloat(cleanCostStr);
                
                if (isNaN(cost)) continue;
                
                const sku = asinToSkuMap.get(asin);
                if (!sku) continue;

                const lastCost = lastKnownCosts.get(sku);
                
                if (lastCost === undefined || lastCost !== cost) {
                    if (!historicalCostsMap.has(sku)) {
                        historicalCostsMap.set(sku, []);
                    }
                    
                    historicalCostsMap.get(sku).push({
                        date: fileDate,
                        cost: cost
                    });
                    
                    lastKnownCosts.set(sku, cost);
                    logger.info(`Costo actualizado para SKU: ${sku} en ${fileDate.toISOString()}: ${cost}`);
                }
            }

            processedFiles++;
            logger.info(`Archivo procesado: ${file.name}. Total procesados: ${processedFiles}/${totalFiles}`);

            if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
                const percentComplete = ((processedFiles / totalFiles) * 100).toFixed(2);
                logger.info(`Progreso: ${percentComplete}% (${processedFiles}/${totalFiles}) archivos procesados.`);
            }

            // Pausa entre solicitudes
            const elapsedTime = Date.now() - startTime;
            const waitTime = Math.max(1000 - elapsedTime, 0);
            await sleep(waitTime);

        } catch (error) {
            logger.error(`Error al procesar el archivo ${file.name}:`, error);
            continue;
        }
    }

    logger.info(`Finalizado el procesamiento de archivos. Total de costos históricos almacenados: ${historicalCostsMap.size}`);
    return historicalCostsMap;
};

// Función para extraer la fecha del nombre del archivo
const extractDateFromFileName = (fileName) => {
    const dateMatch = fileName.match(/^Amazon KPIS-(\d{4}-\d{2}-\d{2})/);
    return dateMatch ? dateMatch[1] : null;
};

// controllers/triggerDailyUpdateController.js
const updateCosts = async (req, res) => {
    try {
        logger.info('Ejecutando actualización diaria de costos de productos.');
        await updateProductCosts();
        logger.info('Actualización diaria de costos completada exitosamente.');
        return res.status(200).json({ message: 'Actualización diaria de costos completada exitosamente.' });
    } catch (error) {
        logger.error('Error durante la actualización diaria de costos de productos', { error });
        return res.status(500).json({ error: 'Error durante la actualización diaria de costos de productos.' });
    }
};





// Si deseas ejecutar la función directamente desde la línea de comandos
if (require.main === module) {
    const args = process.argv.slice(2);
    (async () => {
        try {
            if (args.includes('--init')) {
                const startDate = '2024-09-12'; // Formato YYYY-MM-DD
                await initializeProductCosts(startDate);
                console.log('Inicialización de costos completada a partir del 12/09/2024.');
            } else if (args.includes('--update')) {
                await updateProductCosts();
                console.log('Actualización diaria de costos completada.');
            } else {
                console.log('Uso: node productCostController.js [--init | --update]');
            }
            process.exit(0);
        } catch (error) {
            console.error('Error al ejecutar la operación', error);
            process.exit(1);
        }
    })();
}

// Exportar las funciones
module.exports = {
    initializeProductCosts,
    updateProductCosts,
    updateCosts,
};


