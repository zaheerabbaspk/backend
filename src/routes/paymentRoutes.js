const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Create a new Safepay order
router.post('/create-order', paymentController.createOrder);

// Manual deposit proof submission
router.post('/submit-manual-deposit', upload.single('proof'), paymentController.submitManualDeposit);

// Safepay Webhook endpoint
router.get('/webhook', (req, res) => res.send('Webhook endpoint is active (GET)!'));
router.post('/webhook', paymentController.handleWebhook);

module.exports = router;
