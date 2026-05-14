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
        this.revealTime = 20000;   // 20 seconds to show cards + suspension
        this.hands = [
            { id: 0, name: '8', backOdds: 3.8, layOdds: 3.9, revealed: false, cards: [] },
            { id: 1, name: '9', backOdds: 3.0, layOdds: 3.1, revealed: false, cards: [] },
            { id: 2, name: '10', backOdds: 3.0, layOdds: 3.1, revealed: false, cards: [] },
            { id: 3, name: '11', backOdds: 7.6, layOdds: 7.7, revealed: false, cards: [] }
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
            h.cards = [];
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

        // 1. Check local manualWinner (from socket) first, then Supabase
        let manualWinnerId = this.manualWinner;
        this.manualWinner = null; // Reset local immediately for next round

        if (manualWinnerId === null) {
            try {
                const { data } = await supabase
                    .from('game_controls')
                    .select('manual_winner_id')
                    .eq('game_name', 'card-bet')
                    .single();

                if (data && data.manual_winner_id !== null) {
                    manualWinnerId = data.manual_winner_id;
                    console.log(`[CardBet] Found Manual Winner in Supabase: ${manualWinnerId}`);

                    // Clear Supabase immediately so it doesn't repeat next round
                    await supabase
                        .from('game_controls')
                        .update({ manual_winner_id: null })
                        .eq('game_name', 'card-bet');
                }
            } catch (err) {
                console.error('[CardBet] Supabase fetch error:', err);
            }
        }

        // --- Card Generation Logic ---
        const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
        const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K']; 
        const getCardScore = (val) => {
            if (val === 'K') return 13;
            if (val === 'Q') return 12;
            if (val === 'J') return 11;
            return parseInt(val);
        };

        const usedCards = new Set();
        const drawCard = () => {
            if (usedCards.size >= suits.length * values.length) {
                usedCards.clear(); // Reset if deck empty (unlikely in one round)
            }
            let card;
            do {
                const suit = suits[Math.floor(Math.random() * suits.length)];
                const value = values[Math.floor(Math.random() * values.length)];
                card = { value, suit, score: getCardScore(value) };
            } while (usedCards.has(`${card.value}-${card.suit}`));
            usedCards.add(`${card.value}-${card.suit}`);
            return card;
        };

        // --- Execute Logic ---
        if (manualWinnerId !== null) {
            this.winningHandId = manualWinnerId;
            // For manual winner, we just give them a high card and others lower ones
            this.hands.forEach((h, idx) => {
                let card = drawCard();
                if (idx === this.winningHandId) {
                    const highCards = ['J', 'Q', 'K'];
                    const val = highCards[Math.floor(Math.random() * highCards.length)];
                    h.cards = [{ value: val, suit: card.suit, score: getCardScore(val) }];
                } else {
                    const lowCards = ['6', '7', '8'];
                    const val = lowCards[Math.floor(Math.random() * lowCards.length)];
                    h.cards = [{ value: val, suit: card.suit, score: getCardScore(val) }];
                }
            });
        } else {
            // PROBABILITY / RNG LOGIC
            // 1. Initial draw: 1 card for each
            this.hands.forEach(h => {
                const card = drawCard();
                h.cards = [card];
            });

            const calculateTotal = (hIdx) => this.hands[hIdx].cards.reduce((sum, c) => sum + c.score, 0);

            // 2. Targeted Rematch Loop
            let winnerFound = false;
            while (!winnerFound) {
                // Get all current totals
                const totals = this.hands.map((_, idx) => calculateTotal(idx));
                const maxScore = Math.max(...totals);
                
                // Find how many hands have this max score
                const topHands = [];
                totals.forEach((score, idx) => {
                    if (score === maxScore) topHands.push(idx);
                });

                if (topHands.length === 1) {
                    // Unique winner!
                    this.winningHandId = topHands[0];
                    winnerFound = true;
                } else {
                    // TIE: Draw one more card ONLY for the tied hands
                    console.log(`[CardBet] Targeted Rematch for hands: ${topHands.join(', ')} at score ${maxScore}`);
                    topHands.forEach(idx => {
                        this.hands[idx].cards.push(drawCard());
                    });
                }
            }

            console.log(`[CardBet] Final RNG Winner: ${this.winningHandId} (Totals: ${this.hands.map((_, i) => calculateTotal(i)).join(', ')})`);
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
