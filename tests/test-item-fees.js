// test-item-fees.js
// Script para investigar comisiones y costos de envío desde la API de MercadoLibre

const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

// Conectar a MongoDB
async function connectDB() {
    try {
        await mongoose.connect(process.env.URI_BD_GUATEVER, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('✅ Conectado a MongoDB');
    } catch (error) {
        console.error('❌ Error conectando a MongoDB:', error);
        process.exit(1);
    }
}

// Obtener credenciales
async function getAccessToken() {
    const Credentials = require('./models/meliCredentials');
    const cred = await Credentials.findOne({}).exec();

    if (!cred) {
        throw new Error('No se encontraron credenciales');
    }

    // Verificar si el token está expirado
    const expirationTime = new Date(cred.last_update).getTime() + (cred.expires_in * 1000);
    const isExpired = Date.now() >= expirationTime;

    if (isExpired) {
        console.log('⚠️ Token expirado, renovando...');
        // Renovar token
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
            params: {
                grant_type: 'refresh_token',
                client_id: process.env.MELI_CLIENT_ID,
                client_secret: process.env.MELI_CLIENT_SECRET,
                refresh_token: cred.refresh_token
            }
        });

        await Credentials.updateOne({}, {
            $set: {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token,
                last_update: new Date(),
                expires_in: response.data.expires_in
            }
        });

        return response.data.access_token;
    }

    return cred.access_token;
}

// Función principal de prueba
async function testItemFees(itemId) {
    console.log('\n=====================================');
    console.log(`INVESTIGANDO ITEM: ${itemId}`);
    console.log('=====================================\n');

    try {
        await connectDB();
        const accessToken = await getAccessToken();
        console.log('✅ Access token obtenido\n');

        // 1. Obtener información básica del item
        console.log('📦 1. INFORMACIÓN BÁSICA DEL ITEM:');
        console.log('-----------------------------------');
        const itemResponse = await axios.get(
            `https://api.mercadolibre.com/items/${itemId}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const item = itemResponse.data;
        console.log('- ID:', item.id);
        console.log('- Título:', item.title);
        console.log('- Precio:', item.price);
        console.log('- Categoría:', item.category_id);
        console.log('- Tipo de listing:', item.listing_type_id);
        console.log('- Estado:', item.status);
        console.log('- Envío gratis:', item.shipping?.free_shipping);
        console.log('- Modo de envío:', item.shipping?.mode);
        console.log('- Tipo logístico:', item.shipping?.logistic_type);

        // 2. Obtener comisiones por el precio del item
        console.log('\n💰 2. COMISIONES Y FEES:');
        console.log('------------------------');
        const feesResponse = await axios.get(
            `https://api.mercadolibre.com/sites/MLM/listing_prices`,
            {
                params: {
                    price: item.price,
                    listing_type_id: item.listing_type_id,
                    category_id: item.category_id
                },
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );

        const fees = feesResponse.data;
        console.log('Respuesta completa de fees:', JSON.stringify(fees, null, 2));

        // Buscar la información de sale_fee
        if (fees.length > 0) {
            const feeInfo = fees[0];
            console.log('\n📊 Detalles de comisión:');
            console.log('- Sale fee amount:', feeInfo.sale_fee_amount);
            if (feeInfo.sale_fee_details) {
                console.log('- Percentage fee:', feeInfo.sale_fee_details.percentage_fee);
                console.log('- Fixed fee:', feeInfo.sale_fee_details.fixed_fee);
                console.log('- Gross amount:', feeInfo.sale_fee_details.gross_amount);
                console.log('- MeLi percentage:', feeInfo.sale_fee_details.meli_percentage_fee);
            }
        }

        // 3. Obtener opciones de envío
        console.log('\n📮 3. COSTOS DE ENVÍO:');
        console.log('----------------------');

        // Intentar obtener costos de envío para un código postal de ejemplo (CDMX)
        const zipCode = '01000'; // Código postal de CDMX

        try {
            const shippingResponse = await axios.get(
                `https://api.mercadolibre.com/items/${itemId}/shipping_options`,
                {
                    params: { zip_code: zipCode },
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                }
            );

            console.log('Opciones de envío para CP', zipCode + ':');
            const shippingOptions = shippingResponse.data.options || [];

            shippingOptions.forEach((option, index) => {
                console.log(`\nOpción ${index + 1}:`);
                console.log('- Nombre:', option.name);
                console.log('- Costo:', option.cost);
                console.log('- Costo para el comprador:', option.list_cost);
                console.log('- Tiempo estimado:', option.estimated_delivery_time);
                console.log('- Tipo de envío:', option.shipping_method_id);
            });

        } catch (error) {
            console.log('⚠️ No se pudieron obtener opciones de envío:', error.response?.data?.message || error.message);
        }

        // 4. Si el item tiene seller_id, obtener info adicional de envío
        if (item.seller_id) {
            console.log('\n🚚 4. INFORMACIÓN DE ENVÍO DEL VENDEDOR:');
            console.log('------------------------------------------');

            try {
                // Obtener dimensiones si existen
                const dimensions = item.shipping?.dimensions ?
                    `${item.shipping.dimensions.length}x${item.shipping.dimensions.width}x${item.shipping.dimensions.height},${item.shipping.dimensions.weight}` :
                    '10x10x10,500'; // Dimensiones default para prueba

                const shippingOptionsResponse = await axios.get(
                    `https://api.mercadolibre.com/users/${item.seller_id}/shipping_options/free`,
                    {
                        params: {
                            dimensions: dimensions,
                            item_price: item.price,
                            listing_type_id: item.listing_type_id,
                            condition: item.condition,
                            verbose: true
                        },
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    }
                );

                console.log('Información de envío del vendedor:', JSON.stringify(shippingOptionsResponse.data, null, 2));

            } catch (error) {
                console.log('⚠️ No se pudo obtener info de envío del vendedor:', error.response?.data?.message || error.message);
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ Desconectado de MongoDB');
    }
}

// Ejecutar prueba con el item de ejemplo
const itemId = process.argv[2] || 'MLM2453508147';
testItemFees(itemId);