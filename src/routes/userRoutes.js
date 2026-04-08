const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// Profile routes
router.get('/profile/:userId', userController.getProfile);
router.get('/profile/:userId/payments', userController.getUserPayments);
router.post('/profile/sync', userController.syncProfile);
router.post('/payment-proof', userController.submitPaymentProof);
router.post('/balance/update', userController.updateBalance);

module.exports = router;
