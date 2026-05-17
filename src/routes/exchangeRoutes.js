const express = require('express');
const router = express.Router();
const exchangeController = require('../controllers/exchangeController');

// Public Exchange Matches & Odds
router.get('/matches', exchangeController.getMatches);
router.get('/odds/:marketId', exchangeController.getMarketOdds);

// User Betting Operations
router.post('/bets', exchangeController.placeBet);
router.post('/bets/cancel', exchangeController.cancelBet);
router.get('/bets/:userId', exchangeController.getUserBets);

// Admin Exchange Controls
router.post('/admin/create-market', exchangeController.createMarket);
router.post('/admin/suspend-market', exchangeController.suspendMarket);
router.post('/admin/settle-market', exchangeController.settleMarket);

module.exports = router;
