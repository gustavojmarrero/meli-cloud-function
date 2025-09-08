// routes/productsRoutes.js
const express = require('express');
const router = express.Router();
const { updateCosts } = require('../controllers/productsController');

router.post('/update-costs', updateCosts);

module.exports = router;