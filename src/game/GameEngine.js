const GameState = require('./GameState');
const supabase = require('../config/supabase');

class GameEngine {
    constructor() {
        this.state = GameState.WAITING;
        this.multiplier = 1.00;
        this.crashPoint = 0;
        this.interval = null;
        this.io = null;
        this.waitingTime = 10000; // 10 seconds
        this.crashedTime = 5000;  // 5 seconds
        this.manualCrash = false;
        this.timeLeft = 0;
        this.countdownInterval = null;
    }

    setIo(io) {
        this.io = io;
    }

    start() {
        console.log('Game Engine started');
        this.startWaiting();
    }

    generateCrashPoint() {
        // Basic RNG for crash point, can be leveled up later
        const rand = Math.random();
        if (rand < 0.05) return 1.00; // instant crash
        return (Math.random() * 5 + 1.2).toFixed(2);
    }

    startWaiting() {
        this.state = GameState.WAITING;
        this.multiplier = 1.00;
        this.manualCrash = false;
        this.crashPoint = this.generateCrashPoint();
        this.timeLeft = Math.floor(this.waitingTime / 1000);

        console.log(`Round waiting. Next crash point: ${this.crashPoint}`);

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
        this.broadcastState();

        this.interval = setInterval(() => {
            this.multiplier += 0.01;
            this.broadcastMultiplier();

            if (this.manualCrash || this.multiplier >= this.crashPoint) {
                this.crash();
            }
        }, 100);
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
