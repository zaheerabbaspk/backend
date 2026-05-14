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
        const values = ['8', '9', '10', 'J', 'Q', 'K']; // Ace removed, King is highest
        const getCardScore = (val) => values.indexOf(val);

        const pool = [];
        const usedCards = new Set();
        const drawCard = () => {
            let card;
            do {
                const suit = suits[Math.floor(Math.random() * suits.length)];
                const value = values[Math.floor(Math.random() * values.length)];
                card = { value, suit, score: getCardScore(value) };
            } while (usedCards.has(`${card.value}-${card.suit}`));
            usedCards.add(`${card.value}-${card.suit}`);
            return card;
        };

        // Draw initial 4 cards
        const h8_card = drawCard();
        const h9_card = drawCard();
        const h10_card = drawCard();
        const h11_card = drawCard();

        // Assign initial cards
        this.hands[0].cards = [h8_card];
        this.hands[1].cards = [h9_card];
        this.hands[2].cards = [h10_card];
        this.hands[3].cards = [h11_card];

        // --- Determine Winner based on Pair Comparison Logic ---
        if (manualData && manualData.manual_winner_id !== null) {
            this.winningHandId = manualData.manual_winner_id;
            console.log(`[CardBet] Admin Manual Winner: ${this.winningHandId}`);
            
            // Force manual winner to have the absolute highest card
            this.hands[this.winningHandId].cards = [{ value: 'K', suit: 'spades', score: values.length - 1 }];
        } else {
            // Pair logic: (8+9) vs (10+11)
            const topTotal = h8_card.score + h9_card.score;
            const bottomTotal = h10_card.score + h11_card.score;

            if (topTotal >= bottomTotal) {
                // Top side wins (or tie-break top)
                if (h8_card.score === h9_card.score) {
                    // REMATCH for 8 and 9
                    console.log('[CardBet] Tie Rematch for Top side!');
                    const extra8 = drawCard();
                    const extra9 = drawCard();
                    this.hands[0].cards.push(extra8);
                    this.hands[1].cards.push(extra9);
                    this.winningHandId = extra8.score >= extra9.score ? 0 : 1;
                } else {
                    this.winningHandId = h8_card.score > h9_card.score ? 0 : 1;
                }
            } else {
                // Bottom side wins
                if (h10_card.score === h11_card.score) {
                    // REMATCH for 10 and 11
                    console.log('[CardBet] Tie Rematch for Bottom side!');
                    const extra10 = drawCard();
                    const extra11 = drawCard();
                    this.hands[2].cards.push(extra10);
                    this.hands[3].cards.push(extra11);
                    this.winningHandId = extra10.score >= extra11.score ? 2 : 3;
                } else {
                    this.winningHandId = h10_card.score > h11_card.score ? 2 : 3;
                }
            }
            
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
