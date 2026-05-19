const gameEngine = require('../game/GameEngine');
const cardBetEngine = require('../game/CardBetEngine');

module.exports = (io, socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Send current Crash state
    socket.emit('gameStateUpdate', {
        state: gameEngine.state,
        multiplier: parseFloat(gameEngine.multiplier.toFixed(2)),
        timeLeft: gameEngine.timeLeft,
        roundId: gameEngine.roundId || 'round_' + Date.now(),
        history: gameEngine.history || []
    });

    // Send current CardBet state
    socket.emit('cardBet_StateUpdate', {
        state: cardBetEngine.state,
        timeLeft: cardBetEngine.timeLeft,
        roundId: 'cb_' + Date.now()
    });

    // If game is in REVEALING state, send the current result too
    if (cardBetEngine.state === 'REVEALING') {
        socket.emit('cardBet_Result', {
            winningHandId: cardBetEngine.winningHandId,
            hands: cardBetEngine.hands,
            roundId: 'cb_' + Date.now()
        });
    }

    socket.on('placeBet', (betData) => {
        console.log(`Bet placed by ${socket.id}:`, betData);
        // Logic for Supabase integration for bets would go here
    });

    socket.on('cashout', (cashoutData) => {
        console.log(`Cashout attempt by ${socket.id}:`, cashoutData);
        // Logic for validating cashout and updating Supabase balance
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
    });
};
