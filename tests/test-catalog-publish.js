// test-catalog-publish.js
// Script de prueba para el endpoint de publicación en catálogo

const axios = require('axios');

// Configuración - Ajustar según tu entorno
const API_URL = 'http://localhost:8080/api/mercadolibre/catalog-publish';

// Datos de prueba simulando lo que enviaría Google Sheets
const testData = {
    mlCatalogId: "MLM47135747",  // Reemplazar con un ID real de tu base de datos
    sku: "GM001845"
};

async function testCatalogPublish() {
    console.log('=====================================');
    console.log('TEST: Publicación en Catálogo de MercadoLibre');
    console.log('=====================================');
    console.log('\nDatos de entrada:');
    console.log(JSON.stringify(testData, null, 2));

    try {
        console.log('\nEnviando solicitud a:', API_URL);

        const response = await axios.post(API_URL, testData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('\n✅ Respuesta exitosa:');
        console.log('Status:', response.status);
        console.log('Data:', JSON.stringify(response.data, null, 2));

        // Validar estructura de respuesta esperada por Google Sheets
        const { success, data } = response.data;
        if (success && data) {
            console.log('\n✅ Validación de campos:');
            console.log('- itemId:', data.itemId ? '✓' : '✗');
            console.log('- title:', data.title ? '✓' : '✗');
            console.log('- mlShippingCost:', data.mlShippingCost !== undefined ? '✓' : '✗');
            console.log('- mlSaleCommission:', data.mlSaleCommission !== undefined ? '✓' : '✗');
            console.log('- permalink:', data.permalink ? '✓' : '✗');
        }

    } catch (error) {
        console.error('\n❌ Error en la prueba:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error('Error:', error.message);
        }
    }
}

// Ejecutar prueba
testCatalogPublish();

console.log('\n⚠️  Nota: Asegúrate de que:');
console.log('1. El servidor esté corriendo (npm start)');
console.log('2. Exista el mlCatalogId en la colección asincatalogmappings');
console.log('3. Las credenciales de MercadoLibre estén configuradas correctamente');