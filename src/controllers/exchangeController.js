const exchangeService = require('../services/ExchangeService');

const exchangeController = {
    // Get all matches with runners
    getMatches: async (req, res) => {
        try {
            const markets = await exchangeService.getMarkets();
            res.json({ success: true, data: markets });
        } catch (error) {
            console.error('[ExchangeController] getMatches error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // Get live odds for a single market (aggregates order books)
    getMarketOdds: async (req, res) => {
        try {
            const { marketId } = req.params;
            const odds = await exchangeService.getMarketOdds(marketId);
            if (!odds) {
                return res.status(404).json({ success: false, error: 'Market not found' });
            }
            res.json({ success: true, data: odds });
        } catch (error) {
            console.error('[ExchangeController] getMarketOdds error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // Place a bet
    placeBet: async (req, res) => {
        try {
            const { userId, marketId, runnerId, type, price, size } = req.body;
            if (!userId || !marketId || !runnerId || !type || !price || !size) {
                return res.status(400).json({ success: false, error: 'Missing required betting parameters' });
            }

            const bet = await exchangeService.placeBet(userId, marketId, runnerId, type, price, size);
            res.json({ success: true, data: bet });
        } catch (error) {
            console.error('[ExchangeController] placeBet error:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    },

    // Cancel an unmatched bet
    cancelBet: async (req, res) => {
        try {
            const { userId, betId } = req.body;
            if (!userId || !betId) {
                return res.status(400).json({ success: false, error: 'Missing userId or betId' });
            }

            const result = await exchangeService.cancelBet(userId, betId);
            res.json(result);
        } catch (error) {
            console.error('[ExchangeController] cancelBet error:', error);
            res.status(400).json({ success: false, error: error.message });
        }
    },

    // Get user open/settled bets
    getUserBets: async (req, res) => {
        try {
            const { userId } = req.params;
            const bets = await exchangeService.getUserBets(userId);
            res.json({ success: true, data: bets });
        } catch (error) {
            console.error('[ExchangeController] getUserBets error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // Admin: Create new market
    createMarket: async (req, res) => {
        try {
            const { marketId, sport, tournament, runners } = req.body;
            if (!marketId || !sport || !tournament || !runners || !Array.isArray(runners)) {
                return res.status(400).json({ success: false, error: 'Invalid market creation parameters' });
            }

            const market = await exchangeService.createMarket(marketId, sport, tournament, runners);
            res.json({ success: true, data: market });
        } catch (error) {
            console.error('[ExchangeController] createMarket error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // Admin: Suspend or unsuspend market
    suspendMarket: async (req, res) => {
        try {
            const { marketId, status } = req.body; // 'SUSPENDED' or 'OPEN' or 'CLOSED'
            if (!marketId || !status) {
                return res.status(400).json({ success: false, error: 'Missing parameters' });
            }

            const result = await exchangeService.suspendMarket(marketId, status);
            res.json(result);
        } catch (error) {
            console.error('[ExchangeController] suspendMarket error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    },

    // Admin: Settle market and payout net winnings
    settleMarket: async (req, res) => {
        try {
            const { marketId, winnerRunnerId } = req.body;
            if (!marketId || !winnerRunnerId) {
                return res.status(400).json({ success: false, error: 'Missing marketId or winnerRunnerId' });
            }

            const result = await exchangeService.settleMarket(marketId, winnerRunnerId);
            res.json(result);
        } catch (error) {
            console.error('[ExchangeController] settleMarket error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }
};

module.exports = exchangeController;
