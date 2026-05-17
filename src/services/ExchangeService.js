const supabase = require('../config/supabase');

class ExchangeService {
    constructor() {
        // Fallback in-memory data store in case Supabase tables do not exist
        this.fallbackStore = {
            markets: [
                {
                    id: 'm1',
                    sport: 'cricket',
                    tournament: 'Indian Premier League',
                    startTime: new Date(Date.now() + 11 * 24 * 3600 * 1000).toISOString(),
                    status: 'OPEN',
                    winner_runner_id: null,
                    runners: [
                        { id: 'r1', name: 'Mumbai Indians' },
                        { id: 'r2', name: 'Chennai Super Kings' }
                    ]
                },
                {
                    id: 'm2',
                    sport: 'football',
                    tournament: 'Champions League Final',
                    startTime: new Date().toISOString(),
                    status: 'OPEN',
                    winner_runner_id: null,
                    runners: [
                        { id: 'f1', name: 'Real Madrid' },
                        { id: 'f2', name: 'Manchester City' }
                    ]
                }
            ],
            bets: [],
            exposures: {},
            transactions: []
        };
        this.io = null;
        this.commissionRate = 0.05; // 5% Admin Commission on net winnings
    }

    setIo(io) {
        this.io = io;
    }

    // Check if a table exists in Supabase, else use fallback
    async executeDbQuery(tableName, dbAction, fallbackAction) {
        try {
            return await dbAction();
        } catch (error) {
            // If table does not exist or network fails, gracefully execute the fallback
            if (error.code === '42P01' || error.message?.includes('does not exist')) {
                console.warn(`[ExchangeService] Table "${tableName}" not found in Supabase. Falling back to local in-memory store.`);
                return fallbackAction();
            }
            throw error;
        }
    }

    // ==========================================
    // 1. Market & Odds Management
    // ==========================================

    async getMarkets() {
        return this.executeDbQuery(
            'exchange_markets',
            async () => {
                const { data: markets, error } = await supabase
                    .from('exchange_markets')
                    .select('*, runners:exchange_runners(*)');
                if (error) throw error;
                return markets;
            },
            () => {
                return this.fallbackStore.markets;
            }
        );
    }

    async getMarketById(marketId) {
        const markets = await this.getMarkets();
        return markets.find(m => m.id === marketId) || null;
    }

    // Live Odds aggregator (calculates depth of matched/unmatched orders to build BetPro style order book)
    async getMarketOdds(marketId) {
        const market = await this.getMarketById(marketId);
        if (!market) return null;

        const bets = await this.executeDbQuery(
            'exchange_bets',
            async () => {
                const { data, error } = await supabase
                    .from('exchange_bets')
                    .select('*')
                    .eq('market_id', marketId)
                    .in('status', ['unmatched', 'matched']);
                if (error) throw error;
                return data;
            },
            () => {
                return this.fallbackStore.bets.filter(b => b.market_id === marketId && ['unmatched', 'matched'].includes(b.status));
            }
        );

        // Build the active odds book based on unmatched bets
        const runnersWithOdds = market.runners.map(runner => {
            const runnerBets = bets.filter(b => b.runner_id === runner.id && b.status === 'unmatched');
            
            // Group and aggregate BACK bets (someone is laying or backing)
            // For a BACK box in BetPro, it shows active Lay offers (money waiting to be matched)
            // Let's build simple depth layers
            const backOddsMap = {};
            const layOddsMap = {};

            runnerBets.forEach(bet => {
                const price = parseFloat(bet.price);
                const size = parseFloat(bet.size) - parseFloat(bet.matched_size);
                if (size <= 0) return;

                if (bet.type === 'BACK') {
                    // Back offers provide LAY options for others
                    layOddsMap[price] = (layOddsMap[price] || 0) + size;
                } else {
                    // Lay offers provide BACK options for others
                    backOddsMap[price] = (backOddsMap[price] || 0) + size;
                }
            });

            // Format into sorted arrays for UI columns
            const backOdds = Object.entries(backOddsMap)
                .map(([price, size]) => ({ price: parseFloat(price), size: this.formatSize(size) }))
                .sort((a, b) => b.price - a.price); // Best BACK odds (highest) first

            const layOdds = Object.entries(layOddsMap)
                .map(([price, size]) => ({ price: parseFloat(price), size: this.formatSize(size) }))
                .sort((a, b) => a.price - b.price); // Best LAY odds (lowest) first

            // Fill standard 3-layer layout
            const finalBack = [
                backOdds[2] || { price: 0, size: '0' },
                backOdds[1] || { price: 0, size: '0' },
                backOdds[0] || { price: parseFloat((runner.id === 'r1' ? 1.87 : 2.15).toString()), size: '10K' } // Default mock depth
            ];
            const finalLay = [
                layOdds[0] || { price: parseFloat((runner.id === 'r1' ? 1.90 : 2.20).toString()), size: '15K' }, // Default mock depth
                layOdds[1] || { price: 0, size: '0' },
                layOdds[2] || { price: 0, size: '0' }
            ];

            return {
                id: runner.id,
                name: runner.name,
                odds: {
                    back: finalBack,
                    lay: finalLay
                }
            };
        });

        return {
            id: market.id,
            sport: market.sport,
            tournament: market.tournament,
            startTime: market.startTime,
            status: market.status,
            runners: runnersWithOdds
        };
    }

    formatSize(size) {
        if (size >= 1000000) return (size / 1000000).toFixed(1) + 'M';
        if (size >= 1000) return (size / 1000).toFixed(1) + 'K';
        return Math.round(size).toString();
    }

    // ==========================================
    // 2. Exposure & Balance Lock (Hedging Math)
    // ==========================================

    /**
     * Calculates user projected profit/loss on each runner in a market.
     * Betfair Hedging Exposure calculation.
     */
    calculateProjectedPL(bets, runners) {
        const pl = {};
        runners.forEach(r => { pl[r.id] = 0; });

        bets.forEach(bet => {
            const price = parseFloat(bet.price);
            const size = parseFloat(bet.size);
            const matchedSize = parseFloat(bet.matched_size);
            
            // Use active full size for exposure calculation, matched + unmatched (locked)
            const activeSize = size; 

            if (bet.type === 'BACK') {
                // Winning selection: Profit = activeSize * (price - 1)
                // Losing selections: Loss = -activeSize
                runners.forEach(r => {
                    if (r.id === bet.runner_id) {
                        pl[r.id] += activeSize * (price - 1);
                    } else {
                        pl[r.id] -= activeSize;
                    }
                });
            } else {
                // Winning selection: Loss = -activeSize * (price - 1) (Liability)
                // Losing selections: Profit = activeSize
                runners.forEach(r => {
                    if (r.id === bet.runner_id) {
                        pl[r.id] -= activeSize * (price - 1);
                    } else {
                        pl[r.id] += activeSize;
                    }
                });
            }
        });

        return pl;
    }

    /**
     * Absolute maximum loss across all runners representing user total exposure/risk.
     */
    getMarketExposure(pl) {
        let maxLoss = 0;
        Object.values(pl).forEach(val => {
            if (val < 0) {
                const loss = Math.abs(val);
                if (loss > maxLoss) maxLoss = loss;
            }
        });
        return maxLoss;
    }

    // ==========================================
    // 3. Placing & Matching Bets
    // ==========================================

    async placeBet(userId, marketId, runnerId, type, price, size) {
        price = parseFloat(price);
        size = parseFloat(size);

        if (price <= 1.0 || size <= 0) {
            throw new Error('Invalid price or stake size');
        }

        // 1. Get market details and user profile
        const market = await this.getMarketById(marketId);
        if (!market) throw new Error('Market not found');
        if (market.status !== 'OPEN') throw new Error('Market is suspended or closed');

        const userProfile = await this.executeDbQuery(
            'profiles',
            async () => {
                const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
                if (error) throw error;
                return data;
            },
            () => {
                // Mock balance if profile not found
                return { id: userId, balance: 100000 };
            }
        );

        // 2. Fetch all existing active bets for this user in this market to calculate exposure change
        const userBets = await this.executeDbQuery(
            'exchange_bets',
            async () => {
                const { data, error } = await supabase
                    .from('exchange_bets')
                    .select('*')
                    .eq('user_id', userId)
                    .eq('market_id', marketId)
                    .in('status', ['unmatched', 'matched']);
                if (error) throw error;
                return data;
            },
            () => {
                return this.fallbackStore.bets.filter(b => b.user_id === userId && b.market_id === marketId && ['unmatched', 'matched'].includes(b.status));
            }
        );

        // Calculate current exposure
        const currentPL = this.calculateProjectedPL(userBets, market.runners);
        const currentExposure = this.getMarketExposure(currentPL);

        // Calculate projected exposure with the new bet included
        const candidateBet = { runner_id: runnerId, type, price, size, matched_size: 0 };
        const projectedPL = this.calculateProjectedPL([...userBets, candidateBet], market.runners);
        const projectedExposure = this.getMarketExposure(projectedPL);

        const exposureDifference = projectedExposure - currentExposure;

        // If exposure increases, check if user has enough balance
        if (exposureDifference > 0 && parseFloat(userProfile.balance) < exposureDifference) {
            throw new Error('Insufficient balance for bet placement liability');
        }

        // 3. Create the bet object
        const newBet = {
            id: Math.random().toString(36).substring(2, 15),
            user_id: userId,
            market_id: marketId,
            runner_id: runnerId,
            type,
            price,
            size,
            matched_size: 0,
            status: 'unmatched',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        // 4. Save bet to DB/Store and lock balance if exposure increased
        await this.executeDbQuery(
            'exchange_bets',
            async () => {
                const { error } = await supabase.from('exchange_bets').insert({
                    id: newBet.id,
                    user_id: userId,
                    market_id: marketId,
                    runner_id: runnerId,
                    type,
                    price,
                    size,
                    matched_size: 0,
                    status: 'unmatched'
                });
                if (error) throw error;

                // Update user wallet balance with exposure delta
                if (exposureDifference !== 0) {
                    await supabase
                        .from('profiles')
                        .update({ balance: parseFloat(userProfile.balance) - exposureDifference })
                        .eq('id', userId);
                }
            },
            () => {
                newBet.id = 'b_' + Math.random().toString(36).substring(2, 9);
                this.fallbackStore.bets.push(newBet);
                userProfile.balance = parseFloat(userProfile.balance) - exposureDifference;
                return newBet;
            }
        );

        console.log(`[ExchangeEngine] Bet placed successfully. ID: ${newBet.id}. Exposure delta: ${exposureDifference}`);

        // 5. Run matching engine asynchronously
        setTimeout(() => this.runMatchingEngine(marketId), 50);

        // Notify client
        if (this.io) {
            this.io.emit('odds_update', { marketId });
            this.io.to(userId).emit('open_bets_update');
            this.io.to(userId).emit('balance_update', { balance: userProfile.balance - (exposureDifference > 0 ? exposureDifference : 0) });
        }

        return newBet;
    }

    /**
     * ORDER MATCHING ENGINE (FIFO Queue Matching)
     * Matches BACK bets with LAY bets at matching odds
     */
    async runMatchingEngine(marketId) {
        console.log(`[ExchangeEngine] Running matching engine for market: ${marketId}`);

        // Fetch all active unmatched bets in this market
        const allUnmatchedBets = await this.executeDbQuery(
            'exchange_bets',
            async () => {
                const { data, error } = await supabase
                    .from('exchange_bets')
                    .select('*')
                    .eq('market_id', marketId)
                    .eq('status', 'unmatched')
                    .order('created_at', { ascending: true });
                if (error) throw error;
                return data;
            },
            () => {
                return this.fallbackStore.bets.filter(b => b.market_id === marketId && b.status === 'unmatched');
            }
        );

        if (allUnmatchedBets.length === 0) return;

        // Group by Runner
        const runners = [...new Set(allUnmatchedBets.map(b => b.runner_id))];

        for (const runnerId of runners) {
            const runnerBets = allUnmatchedBets.filter(b => b.runner_id === runnerId);
            const backBets = runnerBets.filter(b => b.type === 'BACK');
            const layBets = runnerBets.filter(b => b.type === 'LAY');

            // Try to match
            for (const backBet of backBets) {
                const remainingBack = parseFloat(backBet.size) - parseFloat(backBet.matched_size);
                if (remainingBack <= 0) continue;

                // Find matching Lay bets (same price or better)
                // Laying price must be <= back price to match
                const matchingLays = layBets
                    .filter(l => parseFloat(l.price) <= parseFloat(backBet.price) && (parseFloat(l.size) - parseFloat(l.matched_size)) > 0)
                    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price)); // Best Lay first

                let backMatchedAmt = parseFloat(backBet.matched_size);

                for (const layBet of matchingLays) {
                    const remainingLay = parseFloat(layBet.size) - parseFloat(layBet.matched_size);
                    const currentUnmatchedBack = parseFloat(backBet.size) - backMatchedAmt;

                    if (currentUnmatchedBack <= 0) break;

                    const matchAmount = Math.min(currentUnmatchedBack, remainingLay);
                    if (matchAmount <= 0) continue;

                    // Match happened!
                    backMatchedAmt += matchAmount;
                    layBet.matched_size = parseFloat(layBet.matched_size) + matchAmount;
                    backBet.matched_size = backMatchedAmt;

                    // Update lay status
                    if (parseFloat(layBet.matched_size) >= parseFloat(layBet.size)) {
                        layBet.status = 'matched';
                    }
                    
                    // Update DB/Store for this Lay Bet
                    await this.updateBetStatus(layBet);

                    console.log(`[ExchangeEngine] MATCHED! BackBet ${backBet.id} and LayBet ${layBet.id} matched amount: ${matchAmount}`);
                }

                // Update back status
                if (backMatchedAmt >= parseFloat(backBet.size)) {
                    backBet.status = 'matched';
                }
                await this.updateBetStatus(backBet);
            }
        }

        // Notify changes
        if (this.io) {
            this.io.emit('odds_update', { marketId });
            this.io.emit('market_matched_update', { marketId });
        }
    }

    async updateBetStatus(bet) {
        await this.executeDbQuery(
            'exchange_bets',
            async () => {
                await supabase
                    .from('exchange_bets')
                    .update({
                        matched_size: bet.matched_size,
                        status: bet.status,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', bet.id);
            },
            () => {
                const idx = this.fallbackStore.bets.findIndex(b => b.id === bet.id);
                if (idx !== -1) {
                    this.fallbackStore.bets[idx] = { ...bet, updated_at: new Date().toISOString() };
                }
            }
        );
    }

    async getUserBets(userId) {
        return this.executeDbQuery(
            'exchange_bets',
            async () => {
                const { data, error } = await supabase
                    .from('exchange_bets')
                    .select('*, runner:exchange_runners(name), market:exchange_markets(tournament)')
                    .eq('user_id', userId)
                    .order('created_at', { ascending: false });
                if (error) throw error;
                return data;
            },
            () => {
                return this.fallbackStore.bets.filter(b => b.user_id === userId);
            }
        );
    }

    async cancelBet(userId, betId) {
        const bet = await this.executeDbQuery(
            'exchange_bets',
            async () => {
                const { data, error } = await supabase.from('exchange_bets').select('*').eq('id', betId).single();
                if (error) throw error;
                return data;
            },
            () => {
                return this.fallbackStore.bets.find(b => b.id === betId);
            }
        );

        if (!bet) throw new Error('Bet not found');
        if (bet.user_id !== userId) throw new Error('Unauthorized');
        if (bet.status !== 'unmatched') throw new Error('Only completely unmatched bets can be cancelled');

        // Cancel bet
        await this.executeDbQuery(
            'exchange_bets',
            async () => {
                await supabase.from('exchange_bets').update({ status: 'cancelled' }).eq('id', betId);
                
                // Refund exposure delta
                const userProfile = await supabase.from('profiles').select('balance').eq('id', userId).single();
                const userBets = await supabase.from('exchange_bets').select('*').eq('user_id', userId).eq('market_id', bet.market_id).in('status', ['unmatched', 'matched']);
                const market = await supabase.from('exchange_markets').select('*, runners:exchange_runners(*)').eq('id', bet.market_id).single();
                
                const currentPL = this.calculateProjectedPL(userBets.data, market.data.runners);
                const currentExposure = this.getMarketExposure(currentPL);

                // Calculate projected exposure without this cancelled bet
                const remainingBets = userBets.data.filter(b => b.id !== betId);
                const projectedPL = this.calculateProjectedPL(remainingBets, market.data.runners);
                const projectedExposure = this.getMarketExposure(projectedPL);

                const refund = currentExposure - projectedExposure;

                if (refund > 0) {
                    await supabase.from('profiles').update({ balance: parseFloat(userProfile.data.balance) + refund }).eq('id', userId);
                }
            },
            () => {
                bet.status = 'cancelled';
                const userProfile = { balance: 100000 };
                // Local refund
                const market = this.fallbackStore.markets.find(m => m.id === bet.market_id);
                const userBets = this.fallbackStore.bets.filter(b => b.user_id === userId && b.market_id === bet.market_id && ['unmatched', 'matched'].includes(b.status));
                const currentPL = this.calculateProjectedPL(userBets, market.runners);
                const currentExposure = this.getMarketExposure(currentPL);

                const remainingBets = userBets.filter(b => b.id !== betId);
                const projectedPL = this.calculateProjectedPL(remainingBets, market.runners);
                const projectedExposure = this.getMarketExposure(projectedPL);

                const refund = currentExposure - projectedExposure;
                userProfile.balance += refund;
            }
        );

        if (this.io) {
            this.io.to(userId).emit('open_bets_update');
            this.io.emit('odds_update', { marketId: bet.market_id });
        }

        return { success: true, message: 'Bet cancelled and exposure refunded' };
    }

    // ==========================================
    // 4. Admin Market Management & Settlement
    // ==========================================

    async createMarket(id, sport, tournament, runnersList) {
        const newMarket = {
            id,
            sport,
            tournament,
            startTime: new Date().toISOString(),
            status: 'OPEN',
            winner_runner_id: null,
            runners: runnersList.map((name, i) => ({ id: `${id}_r${i}`, name }))
        };

        await this.executeDbQuery(
            'exchange_markets',
            async () => {
                await supabase.from('exchange_markets').insert({
                    id: newMarket.id,
                    sport: newMarket.sport,
                    tournament: newMarket.tournament,
                    status: 'OPEN'
                });
                for (const runner of newMarket.runners) {
                    await supabase.from('exchange_runners').insert({
                        id: runner.id,
                        market_id: newMarket.id,
                        name: runner.name
                    });
                }
            },
            () => {
                this.fallbackStore.markets.push(newMarket);
            }
        );

        if (this.io) this.io.emit('markets_updated');
        return newMarket;
    }

    async suspendMarket(marketId, suspendState = 'SUSPENDED') {
        await this.executeDbQuery(
            'exchange_markets',
            async () => {
                await supabase.from('exchange_markets').update({ status: suspendState }).eq('id', marketId);
            },
            () => {
                const market = this.fallbackStore.markets.find(m => m.id === marketId);
                if (market) market.status = suspendState;
            }
        );

        if (this.io) {
            this.io.emit('market_status_update', { marketId, status: suspendState });
            this.io.emit('odds_update', { marketId });
        }
        return { success: true, status: suspendState };
    }

    /**
     * Settle Market
     * Decides winner, calculates net profit/loss, distributes funds, deducts commission.
     */
    async settleMarket(marketId, winnerRunnerId) {
        console.log(`[ExchangeEngine] Settling market ${marketId}. Declared winner selection: ${winnerRunnerId}`);

        const market = await this.getMarketById(marketId);
        if (!market) throw new Error('Market not found');

        // Update market status
        await this.executeDbQuery(
            'exchange_markets',
            async () => {
                await supabase
                    .from('exchange_markets')
                    .update({ status: 'CLOSED', winner_runner_id: winnerRunnerId })
                    .eq('id', marketId);
            },
            () => {
                market.status = 'CLOSED';
                market.winner_runner_id = winnerRunnerId;
            }
        );

        // Fetch all matched bets in this market
        const bets = await this.executeDbQuery(
            'exchange_bets',
            async () => {
                const { data, error } = await supabase
                    .from('exchange_bets')
                    .select('*')
                    .eq('market_id', marketId);
                if (error) throw error;
                return data;
            },
            () => {
                return this.fallbackStore.bets.filter(b => b.market_id === marketId);
            }
        );

        // Filter bets
        const matchedBets = bets.filter(b => b.status === 'matched');
        const unmatchedBets = bets.filter(b => b.status === 'unmatched');

        // 1. VOID and REFUND unmatched bets
        for (const bet of unmatchedBets) {
            bet.status = 'voided';
            await this.updateBetStatus(bet);

            // Refund unmatched stake/exposure to user
            await this.refundUserUnmatched(bet.user_id, bet.market_id, bet.id, parseFloat(bet.size));
        }

        // 2. SETTLE matched bets
        // Group bets by User to calculate NET profit/loss in this market (Hedging balance resolution)
        const userIds = [...new Set(matchedBets.map(b => b.user_id))];

        for (const userId of userIds) {
            const userMatchedBets = matchedBets.filter(b => b.user_id === userId);
            
            // Calculate actual Net P/L on each runner for this user
            const plMap = this.calculateProjectedPL(userMatchedBets, market.runners);
            
            // The profit/loss is determined by which runner actually won
            const netResult = plMap[winnerRunnerId] || 0.00;

            console.log(`[ExchangeSettlement] User ${userId} NET P/L: ${netResult}`);

            // Fetch user profile
            const profile = await this.executeDbQuery(
                'profiles',
                async () => {
                    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
                    if (error) throw error;
                    return data;
                },
                () => {
                    return { balance: 100000 };
                }
            );

            // Calculate exposure locked for this market to release it
            const lockedExposure = this.getMarketExposure(plMap);

            let payout = 0;
            if (netResult > 0) {
                // Winning: Return locked exposure + net profit (minus commission)
                const commission = netResult * this.commissionRate;
                const netProfit = netResult - commission;
                payout = lockedExposure + netProfit;

                console.log(`[ExchangeSettlement] User ${userId} won! Releasing exposure: ${lockedExposure}, Net Profit: ${netProfit}, Commission: ${commission}`);
                
                // Record transactions
                await this.recordTransaction(userId, payout, 'settlement_win', marketId);
                if (commission > 0) {
                    await this.recordTransaction(userId, -commission, 'commission', marketId);
                }
            } else if (netResult < 0) {
                // Losing: Return whatever is left of locked exposure (if hedged)
                const actualLoss = Math.abs(netResult);
                payout = lockedExposure - actualLoss;

                console.log(`[ExchangeSettlement] User ${userId} lost! Releasing remaining exposure refund: ${payout}`);
                await this.recordTransaction(userId, payout, 'settlement_lose', marketId);
            } else {
                // Exact Scratch: Return full locked exposure
                payout = lockedExposure;
                console.log(`[ExchangeSettlement] User ${userId} scratched! Refunding full exposure: ${payout}`);
                await this.recordTransaction(userId, payout, 'settlement_lose', marketId);
            }

            // Update user wallet balance
            if (payout > 0) {
                await this.executeDbQuery(
                    'profiles',
                    async () => {
                        await supabase
                            .from('profiles')
                            .update({ balance: parseFloat(profile.balance) + payout })
                            .eq('id', userId);
                    },
                    () => {
                        profile.balance = parseFloat(profile.balance) + payout;
                    }
                );
            }

            // Update bet statuses individually for clean history
            for (const bet of userMatchedBets) {
                if (bet.type === 'BACK') {
                    bet.status = bet.runner_id === winnerRunnerId ? 'won' : 'lost';
                } else {
                    bet.status = bet.runner_id === winnerRunnerId ? 'lost' : 'won';
                }
                await this.updateBetStatus(bet);
            }

            // Notify client of wallet and history updates
            if (this.io) {
                this.io.to(userId).emit('balance_update', { balance: parseFloat(profile.balance) + payout });
                this.io.to(userId).emit('open_bets_update');
            }
        }

        if (this.io) {
            this.io.emit('market_settled', { marketId, winner: winnerRunnerId });
        }

        return { success: true, message: 'Market settled, exposures resolved, and balances paid out' };
    }

    async refundUserUnmatched(userId, marketId, betId, amount) {
        await this.executeDbQuery(
            'profiles',
            async () => {
                const { data: profile } = await supabase.from('profiles').select('balance').eq('id', userId).single();
                await supabase.from('profiles').update({ balance: parseFloat(profile.balance) + amount }).eq('id', userId);
                await this.recordTransaction(userId, amount, 'cancel_bet', betId);
            },
            () => {
                // Mock balance refund
            }
        );
    }

    async recordTransaction(userId, amount, type, referenceId) {
        await this.executeDbQuery(
            'exchange_transactions',
            async () => {
                await supabase.from('exchange_transactions').insert({
                    user_id: userId,
                    amount,
                    type,
                    reference_id: referenceId
                });
            },
            () => {
                this.fallbackStore.transactions.push({ user_id: userId, amount, type, reference_id: referenceId, created_at: new Date().toISOString() });
            }
        );
    }
}

module.exports = new ExchangeService();
