const GameState = {
    BETTING: 'BETTING',
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
        this.revealTime = 8000;   // 8 seconds to show cards (Result View Phase)
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
        this.startBetting();
    }

    startBetting() {
        this.state = GameState.BETTING;
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
        this.timeLeft = Math.floor(this.revealTime / 1000); // 8 seconds Result View
        this.manualWinner = null; // Reset local immediately for next round

        // --- Card Generation Logic (Omitted for brevity, keeping existing) ---
        // [Logic remains the same...]
        const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
        const values = ['8', '9', '10', 'J', 'Q', 'K']; 
        const getCardScore = (val) => values.indexOf(val);

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

        // --- Execute Win/Loss Logic ---
        // (Re-using existing logic but ensured it's clean)
        let manualWinnerId = this.manualWinner; 
        // [Manual Winner Fetching Logic...]
        try {
            const { data } = await supabase.from('game_controls').select('manual_winner_id').eq('game_name', 'card-bet').single();
            if (data && data.manual_winner_id !== null) manualWinnerId = data.manual_winner_id;
        } catch (err) {}

        if (manualWinnerId !== null) {
            this.winningHandId = manualWinnerId;
            this.hands.forEach((h, idx) => {
                h.cards = [idx === this.winningHandId ? { value: 'K', suit: 'spades', score: 5 } : { value: '8', suit: 'hearts', score: 0 }];
            });
        } else {
            const c8 = drawCard(); const c9 = drawCard(); const c10 = drawCard(); const c11 = drawCard();
            this.hands[0].cards = [c8]; this.hands[1].cards = [c9]; this.hands[2].cards = [c10]; this.hands[3].cards = [c11];
            const topTotal = c8.score + c9.score; const bottomTotal = c10.score + c11.score;
            if (topTotal >= bottomTotal) {
                let cA = c8; let cB = c9; let hA = 0; let hB = 1;
                while (cA.score === cB.score) { cA = drawCard(); cB = drawCard(); this.hands[hA].cards.push(cA); this.hands[hB].cards.push(cB); }
                this.winningHandId = cA.score > cB.score ? hA : hB;
            } else {
                let cA = c10; let cB = c11; let hA = 2; let hB = 3;
                while (cA.score === cB.score) { cA = drawCard(); cB = drawCard(); this.hands[hA].cards.push(cA); this.hands[hB].cards.push(cB); }
                this.winningHandId = cA.score > cB.score ? hA : hB;
            }
        }

        this.hands.forEach(h => h.revealed = true);
        this.broadcastResult();
        this.broadcastState(); // Inform client we are in REVEALING with 8s left

        // Result View Phase Countdown
        this.countdownInterval = setInterval(() => {
            if (this.timeLeft > 0) {
                this.timeLeft--;
                this.broadcastState();
            } else {
                clearInterval(this.countdownInterval);
                this.state = GameState.FINISHED;
                this.startBetting(); // Back to 10s betting
            }
        }, 1000);
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
