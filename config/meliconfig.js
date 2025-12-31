// ../config/meliconfig.js

const axios = require('axios').default;
const setupQueue = require('./setupQueue.js');
const Credentials = require('../models/meliCredentials.js');
const { logToCloud } = require('../utils');
const logger = require('../config/logger');

let queue;

// Inicializar la cola si no está ya inicializada
const initQueue = async () => {
    if (!queue) {
        queue = await setupQueue();
    }
};

// Variable para almacenar credenciales en caché
let cachedCredentials = null;

// Tiempo de buffer para la expiración del token (en milisegundos)
const TOKEN_EXPIRATION_BUFFER = 60 * 1000; // 1 minuto

// Obtener el access token desde la base de datos o caché
const getCredentials = async () => {
    if (cachedCredentials && !isTokenExpired(cachedCredentials)) {
        return cachedCredentials;
    }

    const cred = await Credentials.findOne({}).exec();
    if (!cred) {
        throw new Error('Credenciales de MercadoLibre no encontradas en la base de datos');
    }

    if (isTokenExpired(cred)) {
        const newAccessToken = await refreshToken(cred);
        cred.access_token = newAccessToken;
    }

    cachedCredentials = cred;
    return cred;
};

// Función para renovar el token si está expirado
const refreshToken = async (cred) => {
    try {
        const response = await axios.post('https://api.mercadolibre.com/oauth/token', null, {
            params: {
                grant_type: 'refresh_token',
                client_id: process.env.MELI_CLIENT_ID,
                client_secret: process.env.MELI_CLIENT_SECRET,
                refresh_token: cred.refresh_token
            },
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        // Actualizar la base de datos con el nuevo token
        await Credentials.updateOne({}, {
            $set: {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token,
                last_update: new Date(),
                expires_in: response.data.expires_in
            }
        });

        // Actualizar las credenciales en caché
        cachedCredentials = {
            ...cred.toObject(),
            access_token: response.data.access_token,
            refresh_token: response.data.refresh_token,
            last_update: new Date(),
            expires_in: response.data.expires_in
        };

        logger.info('Token de acceso renovado exitosamente.');
        return response.data.access_token;

    } catch (error) {
        const errorMsg = error.response?.data || error.message;
        logger.error('Error al renovar el token:', errorMsg);
        throw new Error('Error al renovar el token');
    }
};

// Función para verificar si el token ha expirado
const isTokenExpired = (cred) => {
    const expirationTime = new Date(cred.last_update).getTime() + (cred.expires_in * 1000) - TOKEN_EXPIRATION_BUFFER;
    return Date.now() >= expirationTime;
};

// Función auxiliar para pausar la ejecución
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función principal para hacer solicitudes a la API de MercadoLibre con lógica de reintentos
const meliRequest = async (endpoint, method = 'GET', data = null, config = {}) => {
    await initQueue();

    let cred;
    try {
        cred = await getCredentials();
    } catch (error) {
        logger.error('Error al obtener las credenciales:', error.message);
        throw new Error('No se pudieron obtener las credenciales');
    }

    let accessToken = cred.access_token;

    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const response = await queue.add(() =>
                axios({
                    url: `https://api.mercadolibre.com/${endpoint}`,
                    method: method,
                    data: data,
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        ...config.headers
                    },
                    ...config
                })
            );
            return { success: true, data: response.data };
        } catch (error) {
            attempt++;

            if (error.response) {
                const status = error.response.status;
                const errorMessage = error.response.data?.message || error.message;

                if (status === 429) {
                    const waitTime = Math.pow(2, attempt) * 1000; // Backoff exponencial
                    logger.warn(`Error 429 en la solicitud a ${endpoint}: ${errorMessage}. Reintentando en ${waitTime / 1000} segundos (Intento ${attempt}/${maxRetries}).`);
                    await sleep(waitTime);
                } else if (status === 401 && errorMessage === 'invalid_token') {
                    logger.warn('Token inválido, intentando renovar el token y reintentar la solicitud.');
                    try {
                        await refreshToken(cred);
                        cred = await getCredentials();
                        accessToken = cred.access_token;
                    } catch (refreshError) {
                        logger.error('Error al renovar el token después de recibir un 401:', refreshError.message);
                        return { success: false, error: 'Token inválido después del intento de renovación' };
                    }
                } else {
                    logger.error(`Error en la solicitud a ${endpoint}: ${errorMessage}`);
                    if (error.response.data?.cause) {
                        logger.error(`Detalles del error: ${JSON.stringify(error.response.data.cause)}`);
                    }
                    if (error.response.data) {
                        logger.error(`Respuesta completa: ${JSON.stringify(error.response.data)}`);
                    }
                    return { success: false, error: errorMessage, details: error.response.data };
                }
            } else {
                logger.error(`Error en la solicitud a ${endpoint}: ${error.message}`);
                return { success: false, error: error.message };
            }
        }
    }

    logger.error(`Error persistente en la solicitud a ${endpoint} después de ${maxRetries} intentos.`);
    return { success: false, error: 'Se excedió el número máximo de reintentos' };
};

module.exports = { meliRequest };