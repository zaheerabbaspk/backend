const GameState = {
    WAITING: 'WAITING',
    REVEALING: 'REVEALING',
    FINISHED: 'FINISHED'
};

const supabase = require('../config/supabase');
const crypto = require('crypto');

class CardBetEngine {
    constructor() {
        this.state = GameState.FINISHED;
        this.timeLeft = 0;
        this.io = null;
        this.waitingTime = 10000; // 10 seconds betting phase
        this.revealTime = 5000;   // 5 seconds to show cards
        this.hands = [
            { id: 0, name: '8', backOdds: 3.8, layOdds: 3.9, revealed: false, card: null },
            { id: 1, name: '9', backOdds: 3.0, layOdds: 3.1, revealed: false, card: null },
            { id: 2, name: '10', backOdds: 3.0, layOdds: 3.1, revealed: false, card: null },
            { id: 3, name: '11', backOdds: 7.6, layOdds: 7.7, revealed: false, card: null }
        ];
        this.winningHandId = null;
        this.manualWinner = null;
        this.countdownInterval = null;

        // RNG Logic
        this.serverSeed = crypto.randomBytes(32).toString('hex');
        this.nonce = 0;
    }

    setIo(io) {
        this.io = io;
    }

    start() {
        console.log('Card Bet Engine started');
        this.startWaiting();
    }

    startWaiting() {
        this.state = GameState.WAITING;
        this.timeLeft = Math.floor(this.waitingTime / 1000);
        this.manualWinner = null;
        this.winningHandId = null;
        
        // Reset hands
        this.hands.forEach(h => {
            h.revealed = false;
            h.card = null;
        });

        this.broadcastState();

        this.countdownInterval = setInterval(() => {
            if (this.timeLeft > 0) {
                this.timeLeft--;
                this.broadcastState();
            } else {
                clearInterval(this.countdownInterval);
                this.revealResult();
            }
        }, 1000);
    }

    setManualWinner(handId) {
        this.manualWinner = handId;
        console.log(`[CardBet] Admin set manual winner: ${handId}`);
    }

    async revealResult() {
        this.state = GameState.REVEALING;
        
        // 1. Fetch manual winner from Supabase
        let manualData = null;
        try {
            const { data } = await supabase
                .from('game_controls')
                .select('manual_winner_id')
                .eq('game_name', 'card-bet')
                .single();
            manualData = data;
        } catch (err) {
            console.error('[CardBet] Error fetching manual winner:', err);
        }

        // --- Card Generation Logic ---
        const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
        const values = ['8', '9', '10', 'J', 'Q', 'K', 'A']; 
        const getCardScore = (val) => values.indexOf(val);

        const pool = [];
        const usedCards = new Set();
        while(pool.length < 4) {
            const suit = suits[Math.floor(Math.random() * suits.length)];
            const value = values[Math.floor(Math.random() * values.length)];
            if (!usedCards.has(`${value}-${suit}`)) {
                usedCards.add(`${value}-${suit}`);
                pool.push({ value, suit, score: getCardScore(value) });
            }
        }

        // --- Determine Winner based on Pair Comparison Logic ---
        if (manualData && manualData.manual_winner_id !== null) {
            this.winningHandId = manualData.manual_winner_id;
            console.log(`[CardBet] Admin Manual Winner: ${this.winningHandId}`);
            
            // Sort pool so we can give the absolute highest to the manual winner
            pool.sort((a, b) => b.score - a.score);
            const winnerCard = pool.shift();
            
            this.hands.forEach((h, idx) => {
                if (idx === this.winningHandId) {
                    h.card = winnerCard;
                } else {
                    h.card = pool.shift();
                }
            });

            await supabase.from('game_controls').update({ manual_winner_id: null }).eq('game_name', 'card-bet');
        } else {
            // Pair logic: (8+9) vs (10+11)
            const h8 = pool[0];
            const h9 = pool[1];
            const h10 = pool[2];
            const h11 = pool[3];

            const topTotal = h8.score + h9.score;
            const bottomTotal = h10.score + h11.score;

            if (topTotal > bottomTotal) {
                // Top side wins, winner is the higher one between 8 and 9
                this.winningHandId = h8.score >= h9.score ? 0 : 1;
            } else if (bottomTotal > topTotal) {
                // Bottom side wins, winner is the higher one between 10 and 11
                this.winningHandId = h10.score >= h11.score ? 2 : 3;
            } else {
                // RNG tie break
                this.nonce++;
                const hash = crypto.createHmac('sha256', this.serverSeed).update(this.nonce.toString()).digest('hex');
                this.winningHandId = parseInt(hash.substring(0, 8), 16) % 4;
            }

            // Assign cards
            this.hands[0].card = h8;
            this.hands[1].card = h9;
            this.hands[2].card = h10;
            this.hands[3].card = h11;
            
            console.log(`[CardBet] Logic Winner: ${this.winningHandId} (Top: ${topTotal} vs Bottom: ${bottomTotal})`);
        }

        this.hands.forEach(h => h.revealed = true);
        this.broadcastResult();

        setTimeout(() => {
            this.state = GameState.FINISHED;
            this.startWaiting();
        }, this.revealTime);
    }

    broadcastState() {
        if (this.io) {
            this.io.emit('cardBet_StateUpdate', {
                state: this.state,
                timeLeft: this.timeLeft,
                roundId: 'cb_' + Date.now()
            });
        }
    }

    broadcastResult() {
        if (this.io) {
            this.io.emit('cardBet_Result', {
                winningHandId: this.winningHandId,
                hands: this.hands,
                roundId: 'cb_' + Date.now()
            });
        }
    }
}

const instance = new CardBetEngine();
module.exports = instance;
