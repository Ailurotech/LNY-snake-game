const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);

app.use(express.static('public'));

const players = {};
const inspectors = {};
const foods = [];
const FOOD_COUNT = 200;
const COUNTDOWN_TIME = 3; 
const AUTO_READY_TIME = 30; 
const GAME_DURATION = 300; // 5 minutes in seconds
let gameState = 'waiting';
let countdownTime = COUNTDOWN_TIME;
let gameStartInterval = null;
let gameEndTimeout = null;
let roomMaster = null;
let autoReadyTimeout = null;
let gameTimeRemaining = GAME_DURATION;
let gameTimeInterval = null;

function startGameCountdown() {
    // Remove the allPlayersReady check for room master
    if (gameState === 'waiting' && roomMaster) {
        gameState = 'countdown';
        countdownTime = COUNTDOWN_TIME;
        
        if (gameStartInterval) {
            clearInterval(gameStartInterval);
        }
        
        gameStartInterval = setInterval(() => {
            countdownTime--;
            io.emit('countdown', countdownTime);
            
            if (countdownTime <= 0) {
                clearInterval(gameStartInterval);
                gameState = 'playing';
                gameTimeRemaining = GAME_DURATION;
                io.emit('gameStart');
                initializeGame();
                
                // Start game timer
                if (gameTimeInterval) {
                    clearInterval(gameTimeInterval);
                }
                gameTimeInterval = setInterval(() => {
                    if (gameTimeRemaining > 0) {
                        gameTimeRemaining--;
                        io.emit('gameTimeUpdate', gameTimeRemaining);
                    }
                    if (gameTimeRemaining <= 0) {
                        clearInterval(gameTimeInterval);
                        endGame();
                    }
                }, 1000);
            }
        }, 1000);
    }
}

function endGame() {
    gameState = 'ended';
    
    // Clear game timer interval
    if (gameTimeInterval) {
        clearInterval(gameTimeInterval);
    }
    
    // Get winner (player with highest score)
    const winner = Object.entries(players)
        .map(([id, player]) => ({
            id,
            name: player.name,
            score: player.score
        }))
        .sort((a, b) => b.score - a.score)[0];
    
    // Emit game end event with winner info
    io.emit('gameEnd', { winner });
    
    // Reset game state after a delay
    setTimeout(() => {
        gameState = 'waiting';
        gameTimeRemaining = GAME_DURATION;
        Object.values(players).forEach(player => {
            player.ready = false;
            player.score = 0;
        });
        io.emit('gameState', {
            state: 'waiting',
            countdown: COUNTDOWN_TIME,
            roomMaster: roomMaster,
            gameTimeRemaining: gameTimeRemaining
        });
    }, 5000); // Wait 5 seconds before resetting
}

function setNewRoomMaster() {
    const playerIds = Object.keys(players);
    if (playerIds.length > 0) {
        roomMaster = playerIds[0];
        io.emit('roomMaster', roomMaster);
        
        // Start auto-ready timer for room master
        if (autoReadyTimeout) {
            clearTimeout(autoReadyTimeout);
        }
        
        autoReadyTimeout = setTimeout(() => {
            if (players[roomMaster] && !players[roomMaster].ready) {
                players[roomMaster].ready = true;
                io.emit('playerList', Object.values(players).map(player => ({
                    ...player,
                    isRoomMaster: player.id === roomMaster
                })));
            }
        }, AUTO_READY_TIME * 1000);
    } else {
        roomMaster = null;
    }
}

// Add auto-ready timeout for new players
function startAutoReadyTimer(socketId) {
    setTimeout(() => {
        if (players[socketId] && !players[socketId].ready && gameState === 'waiting') {
            players[socketId].ready = true;
            io.emit('playerList', Object.values(players).map(player => ({
                ...player,
                isRoomMaster: player.id === roomMaster
            })));
        }
    }, AUTO_READY_TIME * 1000);
}

function initializeGame() {
    // Clear existing food
    foods.length = 0;
    
    // Generate new food
    for (let i = 0; i < FOOD_COUNT; i++) {
        foods.push(generateFood());
    }
    
    // Reset all players' scores
    Object.values(players).forEach(player => {
        player.score = 0;
        player.segments = [];
    });
}

function generateFood() {
    return {
        x: Math.random() * 3000 - 1500,
        y: Math.random() * 3000 - 1500,
        r: 8,
        color: `hsl(${Math.random() * 360}, 50%, 50%)`,
        value: 1
    };
}

io.on('connection', (socket) => {
    socket.on('sendPing', (sentTime) => {
        socket.emit('receivePing', sentTime);
    });

    socket.on('joinAsPlayer', (name) => {
        players[socket.id] = {
            x: 0,
            y: 0,
            segments: [],
            color: `hsl(${Math.random() * 360}, 50%, 50%)`,
            radius: 10,
            score: 0,
            name: 'Anonymous',
            ready: false
        };
        console.log(`Player joined: ${socket.id}`);
        // Set room master if none exists
        if (!roomMaster) {
            setNewRoomMaster();
        }
        // Send current game state to new player
        socket.emit('gameState', {
            state: gameState,
            countdown: countdownTime,
            roomMaster: roomMaster,
            gameTimeRemaining: gameTimeRemaining
        });
        players[socket.id].name = name;
        io.emit('playerList', Object.values(players).map(player => ({
            ...player,
            isRoomMaster: socket.id === roomMaster
        })));
        
        // Start auto-ready timer for the player
        startAutoReadyTimer(socket.id);  
    });

    // watch as an inspector
    socket.on('joinAsInspector', () => {
        inspectors[socket.id] = {
            id: socket.id,
        };
        console.log(`Inspector joined: ${socket.id}`);
    });

    socket.on('playerReady', () => {
        if (players[socket.id]) {
            // Only allow ready state changes when game is not in progress
            if (gameState !== 'playing') {
                players[socket.id].ready = !players[socket.id].ready;
                io.emit('playerList', Object.values(players).map(player => ({
                    ...player,
                    isRoomMaster: socket.id === roomMaster
                })));
                
                // Notify room master about all players ready status
                const allPlayersReady = Object.values(players).every(player => player.ready);
                io.to(roomMaster).emit('allPlayersReady', allPlayersReady);
            }
        }
    });

    socket.on('startGame', () => {
        // Allow both room master to start new game and players to join mid-game
        if (socket.id === roomMaster || gameState === 'playing') {
            if (gameState === 'playing') {
                // For players joining mid-game, just send them the start event
                socket.emit('gameStart');
            } else {
                // For room master starting a new game
                startGameCountdown();
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        if (players[socket.id]) {
            delete players[socket.id];
        }
        
        if (inspectors[socket.id]) {
            delete inspectors[socket.id];
        }
        
        // If room master disconnected, assign new room master
        if (socket.id === roomMaster) {
            setNewRoomMaster();
        }
        
        io.emit('playerList', Object.values(players).map(player => ({
            ...player,
            isRoomMaster: player.id === roomMaster
        })));
        
        // If not enough players, reset game state
        if (Object.keys(players).length === 0) {
            gameState = 'waiting';
            if (gameStartInterval) {
                clearInterval(gameStartInterval);
            }
            if (gameTimeInterval) {
                clearInterval(gameTimeInterval);
            }
            if (autoReadyTimeout) {
                clearTimeout(autoReadyTimeout);
            }
            io.emit('gameState', { 
                state: 'waiting', 
                countdown: COUNTDOWN_TIME,
                roomMaster: roomMaster,
                gameTimeRemaining: GAME_DURATION
            });
        }
    });

    socket.on('update', (data) => {
        if (players[socket.id] && gameState === 'playing') {
            players[socket.id] = {
                ...players[socket.id],
                ...data,
                score: players[socket.id].score,
                name: data.name || players[socket.id].name
            };
        }
    });

    socket.on('foodEaten', (index) => {
        if (index >= 0 && index < foods.length && gameState === 'playing') {
            if (players[socket.id]) {
                players[socket.id].score += 1;
            }
            foods[index] = generateFood();
        }
    });

    socket.on('playerDied', (foodDots) => {
        if (gameState === 'playing') {
            foodDots.forEach(dot => {
                const index = Math.floor(Math.random() * foods.length);
                foods[index] = {
                    ...dot,
                    value: 1
                };
            });
            
            if (players[socket.id]) {
                players[socket.id].score = 0;
                players[socket.id].segments = [];
            }
        }
    });
});

// Game loop
setInterval(() => {
    if (gameState === 'playing') {
        // Send game state to all players
        io.emit('heartbeat', {
            players,
            foods
        });

        // Update leaderboard
        const leaderboard = Object.entries(players)
            .map(([id, player]) => ({
                id,
                name: player.name,
                score: player.score
            }))
            .sort((a, b) => b.score - a.score);

        io.emit('updateLeaderboard', leaderboard);
    }
}, 16);

const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 