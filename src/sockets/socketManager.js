const playerHandlers = require('./playerHandlers');
const adminHandlers = require('./adminHandlers');

module.exports = (io) => {
    io.on('connection', (socket) => {
        // Basic logic to distinguish admin vs player could be added here
        // For now we'll just log and attach both for simplicity

        // In production, you might check for a token or specific namespace
        const isAdmin = socket.handshake.query.admin === 'true';

        const broadcastStats = () => {
            const playersRoom = io.sockets.adapter.rooms.get('players');
            const activePlayers = playersRoom ? playersRoom.size : 0;
            io.emit('gameStats', { activePlayers });
        }

        if (isAdmin) {
            adminHandlers(io, socket);
        } else {
            // Track player count - simple implementation for now
            socket.join('players');
            broadcastStats();
            playerHandlers(io, socket);
        }

        socket.on('disconnect', () => {
            if (!isAdmin) {
                broadcastStats();
            }
        });
    });
};
