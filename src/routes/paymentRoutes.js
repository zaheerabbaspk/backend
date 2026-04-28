const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Create a new Safepay order
router.post('/create-order', paymentController.createOrder);

// Safepay Webhook endpoint
router.post('/webhook', paymentController.handleWebhook);

module.exports = router;
