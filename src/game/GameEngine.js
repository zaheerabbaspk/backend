const GameState = require('./GameState');
const supabase = require('../config/supabase');
const crypto = require('crypto');

class GameEngine {
    constructor() {
        this.state = GameState.WAITING;
        this.multiplier = 1.00;
        this.crashPoint = 0;
        this.interval = null;
        this.io = null;
        this.waitingTime = 5000;  // 5 seconds
        this.crashedTime = 5000;  // 5 seconds
        this.manualCrash = false;
        this.timeLeft = 0;
        this.countdownInterval = null;
        this.serverSeed = crypto.randomBytes(32).toString('hex');
        this.nonce = 0;
    }

    setIo(io) {
        this.io = io;
    }

    start() {
        console.log('Game Engine started');
        this.startWaiting();
    }

    generateCrashPoint() {
        // Industry Standard "Provably Fair" Logic
        this.nonce++;
        
        // 1. Create a hash from seed + nonce
        const hash = crypto.createHmac('sha256', this.serverSeed)
            .update(this.nonce.toString())
            .digest('hex');

        // 2. Conver the first 8 characters of the hash to a number
        const hashInt = parseInt(hash.substring(0, 8), 16);
        
        // 3. Logarithmic distribution logic (X = hashInt / 2^32)
        const rand = hashInt / Math.pow(2, 32);
        
        // 4. House Edge (1%)
        const houseEdge = 0.01; 
        
        // 5. Formula: (1 - HouseEdge) / (1 - Random)
        const multiplier = (1 - houseEdge) / (1 - rand);
        
        const result = Math.max(1.00, Math.floor(multiplier * 100) / 100);
        return result.toFixed(2);
    }

    startWaiting() {
        this.state = GameState.WAITING;
        this.multiplier = 1.00;
        this.manualCrash = false;
        this.crashPoint = parseFloat(this.generateCrashPoint());
        this.timeLeft = Math.floor(this.waitingTime / 1000);

        console.log(`[GameEngine] Round waiting. Next crash point: ${this.crashPoint}`);

        this.broadcastState();

        // Start countdown
        this.countdownInterval = setInterval(() => {
            if (this.timeLeft > 0) {
                this.timeLeft--;
                this.broadcastState();
            } else {
                clearInterval(this.countdownInterval);
                this.startRunning();
            }
        }, 1000);
    }

    startRunning() {
        this.state = GameState.RUNNING;
        this.startTime = Date.now();
        this.broadcastState();

        // Frequency: 30ms for "Buttery Smooth" updates
        this.interval = setInterval(() => {
            const elapsed = (Date.now() - this.startTime) / 1000;
            
            // Exponential Growth Formula: Multiplier = 1.00 * e^(0.06 * seconds)
            // This mirrors the Spribe experience (takes ~10-12s to hit 2.0x, speeds up later)
            const newMultiplier = 1.00 * Math.exp(0.06 * elapsed);
            this.multiplier = Math.floor(newMultiplier * 100) / 100;

            this.broadcastMultiplier();

            if (this.manualCrash || this.multiplier >= this.crashPoint) {
                this.crash();
            }
        }, 30);
    }

    crash() {
        clearInterval(this.interval);
        this.state = GameState.CRASHED;
        console.log(`Game crashed at ${this.multiplier.toFixed(2)}`);

        if (this.io) {
            this.io.emit('crashEvent', {
                crashMultiplier: parseFloat(this.multiplier.toFixed(2)),
                roundId: 'round_' + Date.now() // temporary round ID
            });
        }
        this.broadcastState();

        setTimeout(() => this.startWaiting(), this.crashedTime);
    }

    triggerManualCrash() {
        if (this.state === GameState.RUNNING) {
            this.manualCrash = true;
        }
    }

    broadcastState() {
        if (this.io) {
            this.io.emit('gameStateUpdate', {
                state: this.state,
                multiplier: parseFloat(this.multiplier.toFixed(2)),
                timeLeft: this.timeLeft,
                roundId: 'round_' + Date.now() // temporary round ID
            });
        }
    }

    broadcastMultiplier() {
        if (this.io) {
            this.io.emit('multiplierUpdate', {
                multiplier: parseFloat(this.multiplier.toFixed(2))
            });
        }
    }
}

const instance = new GameEngine();
module.exports = instance;
