const gameEngine = require('../game/GameEngine');

module.exports = (io, socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Send current state to newly connected player
    socket.emit('gameStateUpdate', {
        state: gameEngine.state,
        multiplier: parseFloat(gameEngine.multiplier.toFixed(2)),
        timeLeft: gameEngine.timeLeft,
        roundId: gameEngine.roundId || 'round_' + Date.now()
    });

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
