const gameEngine = require('../game/GameEngine');
const cardBetEngine = require('../game/CardBetEngine');

module.exports = (io, socket) => {
    console.log(`Admin connected: ${socket.id}`);

    socket.on('manualCrash', (data) => {
        const targetMultiplier = data?.targetMultiplier || null;
        console.log('Admin triggered manual crash', targetMultiplier ? `at ${targetMultiplier}x` : 'immediately');
        gameEngine.triggerManualCrash(targetMultiplier);
    });

    socket.on('cardBet_SetWinner', (data) => {
        console.log('Admin setting card bet winner:', data.handId);
        cardBetEngine.setManualWinner(data.handId);
    });

    socket.on('requestStats', () => {
        const playersRoom = io.sockets.adapter.rooms.get('players');
        const activePlayers = playersRoom ? playersRoom.size : 0;
        
        socket.emit('gameStats', {
            activePlayers: activePlayers
        });
    });

    socket.on('disconnect', () => {
        console.log(`Admin disconnected: ${socket.id}`);
    });
};
