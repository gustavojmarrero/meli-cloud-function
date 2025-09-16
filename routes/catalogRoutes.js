// routes/catalogRoutes.js
const express = require('express');
const router = express.Router();
const {
    publishToCatalog,
    getListingStatus,
    getListings
} = require('../controllers/catalogController');

// Endpoint principal para publicar en catálogo
// POST /mercadolibre/catalog-publish
router.post('/catalog-publish', publishToCatalog);

// Endpoint para consultar el estado de una publicación
// GET /mercadolibre/listing/:itemId
router.get('/listing/:itemId', getListingStatus);

// Endpoint para listar todas las publicaciones creadas
// GET /mercadolibre/listings
router.get('/listings', getListings);

module.exports = router;