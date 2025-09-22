// routes/productsRoutes.js
const express = require('express');
const router = express.Router();
const { updateCosts, getProductsByInventoryIds } = require('../controllers/productsController');

router.post('/update-costs', updateCosts);
router.post('/by-inventory-ids', getProductsByInventoryIds);

module.exports = router;