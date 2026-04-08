const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// Admin routes
router.get('/stats', adminController.getStats);
router.get('/users', adminController.getAllUsers);
router.get('/admins', adminController.getAdmins);
router.put('/users/:userId/status', adminController.updateUserStatus);
router.post('/settings', adminController.updateGameSettings);
router.post('/crash', adminController.triggerCrash);

router.get('/payment-proofs', adminController.getPaymentProofs);
router.put('/payment-proofs/:id', adminController.handlePaymentProof);

module.exports = router;
