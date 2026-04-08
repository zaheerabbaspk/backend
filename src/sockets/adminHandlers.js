const gameEngine = require('../game/GameEngine');

module.exports = (io, socket) => {
    console.log(`Admin connected: ${socket.id}`);

    socket.on('manualCrash', () => {
        console.log('Admin triggered manual crash');
        gameEngine.triggerManualCrash();
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
