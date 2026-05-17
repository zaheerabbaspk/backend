require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const socketManager = require('./sockets/socketManager');
const gameEngine = require('./game/GameEngine');
const cardBetEngine = require('./game/CardBetEngine');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const exchangeRoutes = require('./routes/exchangeRoutes');
const exchangeService = require('./services/ExchangeService');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'ok', state: gameEngine.state });
});

app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/exchange', exchangeRoutes);

// Initialize Sockets
socketManager(io);
exchangeService.setIo(io);

// Initialize Game Engines
gameEngine.setIo(io);
gameEngine.start();

cardBetEngine.setIo(io);
cardBetEngine.start();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
