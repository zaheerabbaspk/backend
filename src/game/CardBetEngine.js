const GameState = {
    WAITING: 'WAITING',
    REVEALING: 'REVEALING',
    FINISHED: 'FINISHED'
};

const supabase = require('../config/supabase');

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
        try {
            const { data, error } = await supabase
                .from('game_controls')
                .select('manual_winner_id')
                .eq('game_name', 'card-bet')
                .single();
            
            if (data && data.manual_winner_id !== null) {
                this.winningHandId = data.manual_winner_id;
                console.log(`[CardBet] Using Supabase manual winner: ${this.winningHandId}`);
                
                // 2. Reset manual winner in Supabase for next round
                await supabase
                    .from('game_controls')
                    .update({ manual_winner_id: null })
                    .eq('game_name', 'card-bet');
            } else {
                // Random if not manual
                this.winningHandId = Math.floor(Math.random() * 4);
            }
        } catch (err) {
            console.error('[CardBet] Error fetching manual winner:', err);
            this.winningHandId = Math.floor(Math.random() * 4);
        }

        // Assign cards (simplified logic: winning hand gets high card, others get low)
        this.hands.forEach((h, idx) => {
            if (idx === this.winningHandId) {
                h.card = { value: 'A', suit: 'spades' }; // Example winning card
            } else {
                h.card = { value: '2', suit: 'hearts' }; // Example losing card
            }
            h.revealed = true;
        });

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
