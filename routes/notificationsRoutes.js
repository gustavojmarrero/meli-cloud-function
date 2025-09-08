// routes/meliNotificationsRoutes.js
const express = require('express');
const router = express.Router();
const { receiveNotification } = require('../controllers/notificationsController');

router.post('/', receiveNotification);

module.exports = router;