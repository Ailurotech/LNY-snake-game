// Get DOM elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoresDiv = document.getElementById('scores');
const gameOverDiv = document.getElementById('gameOver');
const nameModal = document.getElementById('nameModal');
const playerNameInput = document.getElementById('playerName');
const enterGameButton = document.getElementById('enterGameButton');
const waitingRoom = document.getElementById('waitingRoom');
const playerList = document.getElementById('playerList');
const countdownDisplay = document.getElementById('countdown');
const readyButton = document.getElementById('readyButton');
const startGameButton = document.getElementById('startGameButton');
const waitingMessage = document.getElementById('waitingMessage');
const volumeSlider = document.getElementById('volumeSlider');

// Set canvas size
canvas.width = window.innerWidth - 50;
canvas.height = window.innerHeight - 50;

// Game variables
const socket = io();
let snake;
let foods = [];
let otherPlayers = {};
let mouseX = 0;
let mouseY = 0;
let gameOver = false;
let playerName = '';
let gameTimer = 20; // Match server's GAME_DURATION
let gameTimerInterval = null;
let animationId = null; // Animation frame ID

// music
const lobbyMusic = new Audio('music/lobby.mp3');
const loseMusic = new Audio('music/lose.mp3');
const winMusic = new Audio('music/win.mp3');
const bgm = new Audio('music/Normal.mp3');

// Hide UI elements initially
canvas.style.display = 'none';
document.getElementById('leaderboard').style.display = 'none';
waitingRoom.style.display = 'none';

// Game state
let isReady = false;
let gameStarted = false;
let isRoomMaster = false;
let gameState = 'waiting';

// Add timer display div
const timerDiv = document.createElement('div');
timerDiv.style.position = 'fixed';
timerDiv.style.bottom = '20px';
timerDiv.style.left = '20px';
timerDiv.style.color = 'white';
timerDiv.style.background = 'rgba(0, 0, 0, 0.7)';
timerDiv.style.padding = '10px';
timerDiv.style.borderRadius = '5px';
timerDiv.style.fontSize = '20px';
timerDiv.style.fontWeight = 'bold';
timerDiv.style.zIndex = '100';
document.body.appendChild(timerDiv);

// Stop all music
function stopAllMusic() {
    loseMusic.pause();
    loseMusic.currentTime = 0;
    winMusic.pause();
    winMusic.currentTime = 0;
    bgm.pause();
    bgm.currentTime = 0;
    lobbyMusic.pause();
    lobbyMusic.currentTime = 0;
}

// Play a specific music
function playMusic(music, loop=true) {
    stopAllMusic();
    music.loop = loop;
    music.play().catch(error => console.error('Error playing music:', error));
}

volumeSlider.addEventListener('input', () => {
    loseMusic.volume = volumeSlider.value;
    winMusic.volume = volumeSlider.value;
    lobbyMusic.volume = volumeSlider.value;
    bgm.volume = volumeSlider.value;
});

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function startGameTimer() {
    if (gameTimerInterval) {
        clearInterval(gameTimerInterval);
    }
    
    gameTimerInterval = setInterval(() => {
        if (gameTimer > 0) {
            gameTimer--;
            updateTimerDisplay();
        }
        
        if (gameTimer <= 0) {
            clearInterval(gameTimerInterval);
            updateTimerDisplay(); // Keep the final time visible
        }
    }, 1000);
}

function updateTimerDisplay() {
    timerDiv.textContent = `Time: ${formatTime(gameTimer)}`;
}

// Handle enter game button click
enterGameButton.addEventListener('click', () => {
    playerName = playerNameInput.value.trim();
    if (playerName) {
        nameModal.style.display = 'none';
        waitingRoom.style.display = 'block';
        socket.emit('setName', playerName);
        
        // If game is in progress, show appropriate message
        if (gameState === 'playing') {
            waitingMessage.textContent = 'Game in progress! You will join when ready.';
            waitingMessage.style.color = '#4CAF50';
            readyButton.textContent = 'Join Game';
            readyButton.style.background = '#4CAF50';
        }

        // Play lobby music
        playMusic(lobbyMusic);
    }
});

// Handle ready button click (for all players including master)
readyButton.addEventListener('click', () => {
    if (gameState === 'playing') {
        // If game is in progress, clicking ready/join will start the game for this player
        waitingRoom.style.display = 'none';
        canvas.style.display = 'block';
        document.getElementById('leaderboard').style.display = 'block';
        gameStarted = true;
        
        // Initialize new snake for mid-game joiner
        const startPos = getRandomPosition();
        snake = new Snake(startPos.x, startPos.y);
        gameOver = false;
        
        // Start game loop and socket events
        socket.on('heartbeat', function(data) {
            otherPlayers = data.players;
            foods = data.foods;
        });

        socket.on('updateLeaderboard', function(data) {
            updateLeaderboard(data);
        });

        gameLoop();
    } else {
        // Normal ready/not ready toggle for waiting state
        isReady = !isReady;
        readyButton.textContent = isReady ? 'Not Ready' : 'Ready';
        readyButton.style.background = isReady ? '#ff0000' : '#4CAF50';
        socket.emit('playerReady');
    }
});

// Handle start game button click (for room master)
startGameButton.addEventListener('click', () => {
    if (isRoomMaster) {
        socket.emit('startGame');
        startGameButton.disabled = true;
        startGameButton.style.opacity = '0.5';
    }
});

// Update UI based on room master status
function updateStartButton() {
    if (isRoomMaster) {
        startGameButton.style.display = 'inline-block';
    } else {
        startGameButton.style.display = 'none';
    }
}

// Socket events for game state
socket.on('gameState', (data) => {
    // Store current game state
    gameState = data.state;
    
    if (data.state === 'playing') {
        // Don't automatically start game for new players
        // They need to click "Join Game" button first
        if (gameStarted) {
            waitingRoom.style.display = 'none';
            canvas.style.display = 'block';
            document.getElementById('leaderboard').style.display = 'block';
        }
        // Set initial game timer from server
        gameTimer = data.gameTimeRemaining || 0;
        updateTimerDisplay();
        
        // Update waiting room message if visible and player has entered name
        if (waitingRoom.style.display === 'block' && playerName) {
            waitingMessage.textContent = 'Game in progress! You will join when ready.';
            waitingMessage.style.color = '#4CAF50';
            readyButton.textContent = 'Join Game';
            readyButton.style.background = '#4CAF50';
        }
    } else if (data.state === 'countdown') {
        if (playerName) {
            countdownDisplay.style.display = 'block';
            countdownDisplay.textContent = `Game starts in ${data.countdown}`;
            countdownDisplay.style.fontSize = '48px';
            countdownDisplay.style.color = '#4CAF50';
        }
    } else if (data.state === 'waiting') {
        // Reset UI for waiting state
        gameStarted = false;
        // Only show waiting room if player has entered name
        if (playerName) {
            waitingRoom.style.display = 'block';
        }
        canvas.style.display = 'none';
        document.getElementById('leaderboard').style.display = 'none';
        countdownDisplay.style.display = 'none';
        gameOver = false;
        readyButton.textContent = 'Ready';
        readyButton.style.background = '#4CAF50';
        if (gameTimerInterval) {
            clearInterval(gameTimerInterval);
        }

        // Switch back to lobby music when waiting
        playMusic(lobbyMusic);
    }
    
    // Update room master status
    isRoomMaster = socket.id === data.roomMaster;
    updateStartButton();
});

// Add countdown socket event
socket.on('countdown', (time) => {
    countdownDisplay.style.display = 'block';
    countdownDisplay.textContent = `Game starts in ${time}`;
    countdownDisplay.style.fontSize = '48px';
    countdownDisplay.style.color = '#4CAF50';
    
    if (time === 0) {
        countdownDisplay.style.display = 'none';
        waitingRoom.style.display = 'none';
        canvas.style.display = 'block';
        document.getElementById('leaderboard').style.display = 'block';
    }
});

// Add game start socket event
socket.on('gameStart', () => {
    gameStarted = true;
    countdownDisplay.style.display = 'none';
    waitingRoom.style.display = 'none';
    canvas.style.display = 'block';
    document.getElementById('leaderboard').style.display = 'block';
    // Play bgm
    playMusic(bgm);    
    init();
});

// Add new socket event for game time updates
socket.on('gameTimeUpdate', (timeRemaining) => {
    gameTimer = timeRemaining;
    updateTimerDisplay();
});

// Handle enter key in name input
playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        enterGameButton.click();
    }
});

// Game boundaries
const WORLD_SIZE = 3000;
const WORLD_BOUNDS = {
    minX: -WORLD_SIZE/2,
    maxX: WORLD_SIZE/2,
    minY: -WORLD_SIZE/2,
    maxY: WORLD_SIZE/2
};

class Vector {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    add(v) {
        this.x += v.x;
        this.y += v.y;
    }

    sub(v) {
        return new Vector(this.x - v.x, this.y - v.y);
    }

    mult(n) {
        this.x *= n;
        this.y *= n;
    }

    normalize() {
        const len = Math.sqrt(this.x * this.x + this.y * this.y);
        if (len !== 0) {
            this.x /= len;
            this.y /= len;
        }
    }

    copy() {
        return new Vector(this.x, this.y);
    }
}

class Snake {
    constructor(x, y) {
        this.pos = new Vector(x, y);
        this.vel = new Vector(0, 0);  // Start with zero velocity
        this.segments = [];
        this.radius = 10;
        this.length = 50;
        this.color = `hsl(${Math.random() * 360}, 50%, 50%)`;
        this.isDead = false;
        
        // Initialize segments
        for (let i = 0; i < this.length; i++) {
            this.segments.push(new Vector(x - i, y));
        }
    }

    update() {
        if (this.isDead) return;

        const CONSTANT_SPEED = 2;  
        
        // Calculate direction based on control type
        let moveVec;
        if (isMobileControl) {
            if (Math.abs(joystickData.x) > 0.1 || Math.abs(joystickData.y) > 0.1) {
                moveVec = new Vector(joystickData.x, joystickData.y);
            } else {
                moveVec = new Vector(this.vel.x, this.vel.y);
            }
        } else {
            const center = new Vector(canvas.width/2, canvas.height/2);
            moveVec = new Vector(mouseX - center.x, mouseY - center.y);
        }

        // Normalize and apply constant speed
        if (moveVec.x !== 0 || moveVec.y !== 0) {
            const len = Math.sqrt(moveVec.x * moveVec.x + moveVec.y * moveVec.y);
            moveVec.x = (moveVec.x / len) * CONSTANT_SPEED;
            moveVec.y = (moveVec.y / len) * CONSTANT_SPEED;
        }

        // Smooth turning
        this.vel.x = this.vel.x * 0.9 + moveVec.x * 0.1;
        this.vel.y = this.vel.y * 0.9 + moveVec.y * 0.1;

        // Ensure constant speed
        const currentSpeed = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
        if (currentSpeed > 0) {
            this.vel.x = (this.vel.x / currentSpeed) * CONSTANT_SPEED;
            this.vel.y = (this.vel.y / currentSpeed) * CONSTANT_SPEED;
        }
        
        // Update head position
        this.pos.add(this.vel);
        
        // Check world boundaries
        if (this.pos.x < WORLD_BOUNDS.minX || this.pos.x > WORLD_BOUNDS.maxX ||
            this.pos.y < WORLD_BOUNDS.minY || this.pos.y > WORLD_BOUNDS.maxY) {
            this.die();
            return;
        }

        // Check collision with other snakes
        for (const id in otherPlayers) {
            if (id !== socket.id) {
                const otherSnake = otherPlayers[id];
                for (const segment of otherSnake.segments) {
                    const dx = this.pos.x - segment.x;
                    const dy = this.pos.y - segment.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < this.radius + otherSnake.radius) {
                        this.die();
                        return;
                    }
                }
            }
        }
        
        // Update segments
        let prev = this.pos.copy();
        for (let segment of this.segments) {
            const temp = segment.copy();
            segment.x = prev.x;
            segment.y = prev.y;
            prev = temp;
        }
    }

    die() {
        this.isDead = true;
        gameOver = true;
        gameOverDiv.style.display = 'block';

        // Play lose music
        playMusic(loseMusic, false);
        
        // Clear game timer
        if (gameTimerInterval) {
            clearInterval(gameTimerInterval);
        }

        // Calculate position for food dots, shifted away from border if needed
        let foodX = this.pos.x;
        let foodY = this.pos.y;
        const shiftAmount = 50;

        // Only shift if we hit a border
        if (this.pos.x <= WORLD_BOUNDS.minX) foodX = WORLD_BOUNDS.minX + shiftAmount;
        else if (this.pos.x >= WORLD_BOUNDS.maxX) foodX = WORLD_BOUNDS.maxX - shiftAmount;
        if (this.pos.y <= WORLD_BOUNDS.minY) foodY = WORLD_BOUNDS.minY + shiftAmount;
        else if (this.pos.y >= WORLD_BOUNDS.maxY) foodY = WORLD_BOUNDS.maxY - shiftAmount;

        // Create food dots at the death position
        const foodDots = [];
        // Create one dot for each segment plus head
        for (let i = 0; i < this.segments.length + 1; i++) {
            foodDots.push({
                x: foodX,
                y: foodY,
                r: this.radius,
                color: this.color,
                value: 1
            });
        }

        // Send food dots to server
        socket.emit('playerDied', foodDots);
        
        // Clear segments
        this.segments = [];
    }

    draw(ctx) {
        if (this.isDead) return;
        
        ctx.fillStyle = this.color;
        
        // Draw segments
        for (let i = 0; i < this.segments.length; i++) {
            const size = this.radius * (1 - i/this.segments.length * 0.5);
            ctx.beginPath();
            ctx.arc(this.segments[i].x, this.segments[i].y, size, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Draw head
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fill();

        // Draw eyes
        const angle = Math.atan2(this.vel.y, this.vel.x);
        const eyeDistance = this.radius * 0.5;
        const eyeSize = this.radius * 0.3;
        const eyeOffset = this.radius * 0.3;

        // Left eye position
        const leftEyeX = this.pos.x + Math.cos(angle - 0.5) * eyeDistance;
        const leftEyeY = this.pos.y + Math.sin(angle - 0.5) * eyeDistance;
        
        // Right eye position
        const rightEyeX = this.pos.x + Math.cos(angle + 0.5) * eyeDistance;
        const rightEyeY = this.pos.y + Math.sin(angle + 0.5) * eyeDistance;

        // Draw eye whites
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(leftEyeX, leftEyeY, eyeSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rightEyeX, rightEyeY, eyeSize, 0, Math.PI * 2);
        ctx.fill();

        // Draw pupils
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(leftEyeX + Math.cos(angle) * eyeOffset * 0.3, 
                leftEyeY + Math.sin(angle) * eyeOffset * 0.3, 
                eyeSize * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(rightEyeX + Math.cos(angle) * eyeOffset * 0.3, 
                rightEyeY + Math.sin(angle) * eyeOffset * 0.3, 
                eyeSize * 0.5, 0, Math.PI * 2);
        ctx.fill();

        // Draw name
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(playerName, this.pos.x, this.pos.y - this.radius - 5);
    }

    eat(food) {
        if (this.isDead) return false;
        
        const dx = this.pos.x - food.x;
        const dy = this.pos.y - food.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < this.radius + food.r) {
            this.grow(food.value || 1);
            return true;
        }
        return false;
    }

    grow(value = 1) {
        // Add a new segment every time food is eaten
        const last = this.segments[this.segments.length - 1].copy();
        this.segments.push(last);
        this.length++;
        
        // Very small radius increase
        this.radius = Math.min(this.radius + 0.02, 25);
    }
}

// Draw grid
function drawGrid(ctx, offsetX, offsetY) {
    // Only draw world bounds
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 5;
    ctx.strokeRect(
        WORLD_BOUNDS.minX + offsetX,
        WORLD_BOUNDS.minY + offsetY,
        WORLD_SIZE,
        WORLD_SIZE
    );
}

// Add function to generate random position within world bounds
function getRandomPosition() {
    // Add some padding from the borders (100 units)
    const padding = 100;
    return {
        x: Math.random() * (WORLD_SIZE - 2 * padding) + WORLD_BOUNDS.minX + padding,
        y: Math.random() * (WORLD_SIZE - 2 * padding) + WORLD_BOUNDS.minY + padding
    };
}

// Initialize game
function init() {
    const startPos = getRandomPosition();
    snake = new Snake(startPos.x, startPos.y);
    gameOver = false;
    
    // Remove any existing socket listeners to prevent duplicates
    socket.off('heartbeat');
    socket.off('updateLeaderboard');
    
    // Socket events
    socket.on('heartbeat', function(data) {
        otherPlayers = data.players;
        foods = data.foods;
    });

    socket.on('updateLeaderboard', function(data) {
        updateLeaderboard(data);
    });

    // Start game loop
    gameLoop();
}

// Track mouse movement
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
});

// Update leaderboard display
function updateLeaderboard(data) {
    const topPlayers = data.slice(0, 5);
    scoresDiv.innerHTML = `
        <h3 style="margin-bottom: 10px; color: #FFD700;">🏆 Leaderboard</h3>
        ${topPlayers.map((player, index) => `
            <div style="
                padding: 5px 10px;
                margin: 3px 0;
                background: rgba(0, 0, 0, 0.5);
                border-radius: 5px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                ${index === 0 ? 'border: 1px solid #FFD700;' : ''}
            ">
                <span>${index + 1}. ${player.name}</span>
                <span style="color: ${index === 0 ? '#FFD700' : 'white'}">${player.score}</span>
            </div>
        `).join('')}
    `;
}

// Game loop
function gameLoop() {
    if (!gameOver) {
        // Clear canvas
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Calculate camera offset
        const offsetX = canvas.width/2 - snake.pos.x;
        const offsetY = canvas.height/2 - snake.pos.y;
        
        // Draw grid
        drawGrid(ctx, offsetX, offsetY);
        
        // Draw food
        for (const food of foods) {
            ctx.fillStyle = food.color || '#ff0000';
            ctx.beginPath();
            ctx.arc(food.x + offsetX, food.y + offsetY, food.r, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Draw other players
        for (const id in otherPlayers) {
            if (id !== socket.id) {
                const player = otherPlayers[id];
                ctx.fillStyle = player.color;

                // Draw segments
                for (const segment of player.segments) {
                    ctx.beginPath();
                    ctx.arc(segment.x + offsetX, segment.y + offsetY, player.radius, 0, Math.PI * 2);
                    ctx.fill();
                }

                // If player has at least one segment (for direction)
                if (player.segments.length > 0) {
                    // Calculate direction
                    const dx = player.x - player.segments[0].x;
                    const dy = player.y - player.segments[0].y;
                    const angle = Math.atan2(dy, dx);

                    // Draw eyes
                    const eyeDistance = player.radius * 0.5;
                    const eyeSize = player.radius * 0.3;
                    const eyeOffset = player.radius * 0.3;

                    // Left eye position
                    const leftEyeX = player.x + Math.cos(angle - 0.5) * eyeDistance;
                    const leftEyeY = player.y + Math.sin(angle - 0.5) * eyeDistance;
                    
                    // Right eye position
                    const rightEyeX = player.x + Math.cos(angle + 0.5) * eyeDistance;
                    const rightEyeY = player.y + Math.sin(angle + 0.5) * eyeDistance;

                    // Draw eye whites
                    ctx.fillStyle = 'white';
                    ctx.beginPath();
                    ctx.arc(leftEyeX + offsetX, leftEyeY + offsetY, eyeSize, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(rightEyeX + offsetX, rightEyeY + offsetY, eyeSize, 0, Math.PI * 2);
                    ctx.fill();

                    // Draw pupils
                    ctx.fillStyle = 'black';
                    ctx.beginPath();
                    ctx.arc(leftEyeX + Math.cos(angle) * eyeOffset * 0.3 + offsetX, 
                            leftEyeY + Math.sin(angle) * eyeOffset * 0.3 + offsetY, 
                            eyeSize * 0.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(rightEyeX + Math.cos(angle) * eyeOffset * 0.3 + offsetX, 
                            rightEyeY + Math.sin(angle) * eyeOffset * 0.3 + offsetY, 
                            eyeSize * 0.5, 0, Math.PI * 2);
                    ctx.fill();

                    // Draw name
                    ctx.fillStyle = 'white';
                    ctx.font = '14px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(player.name, player.x + offsetX, player.y + offsetY - player.radius - 5);
                }
            }
        }
        
        // Update and draw player snake
        snake.update();
        ctx.save();
        ctx.translate(offsetX, offsetY);
        snake.draw(ctx);
        ctx.restore();
        
        // Check for food collision
        for (let i = foods.length - 1; i >= 0; i--) {
            if (snake.eat(foods[i])) {
                socket.emit('foodEaten', i);
            }
        }
        
        // Send player data to server
        socket.emit('update', {
            x: snake.pos.x,
            y: snake.pos.y,
            segments: snake.segments.map(s => ({x: s.x, y: s.y})),
            color: snake.color,
            radius: snake.radius,
            name: playerName
        });
    }
    
    animationId = requestAnimationFrame(gameLoop);
}

// Handle window resize
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth - 50;
    canvas.height = window.innerHeight - 50;
});

// Add restart function
function restartGame() {
    // Cancel previous game loop
    if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    gameOver = false;
    gameOverDiv.style.display = 'none';
    canvas.style.display = 'block';
    document.getElementById('leaderboard').style.display = 'block';
    
    // Create new snake at random position with zero initial velocity
    const startPos = getRandomPosition();
    snake = new Snake(startPos.x, startPos.y);
    
    // Reset any accumulated movement data
    joystickData = { x: 0, y: 0 };
    lastMoveVec = new Vector(0, 0);
    
    // Start game timer
    startGameTimer();

    // Play bgm
    playMusic(bgm);
    
    // Start game loop
    gameLoop();
}

// Update the game over div event listener
document.getElementById('playAgain').onclick = (e) => {
    e.preventDefault();
    restartGame();
};

// Add mobile control variables
const mobileControls = document.getElementById('mobileControls');
const joystick = document.getElementById('joystick');
const stick = document.getElementById('stick');
let isMobileControl = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
let joystickData = { x: 0, y: 0 };
let lastMoveVec = new Vector(0, 0);

// Joystick touch handling
let isJoystickActive = false;
const joystickBounds = {
    maxDistance: 35,  // Maximum distance stick can move from center
    centerX: 0,
    centerY: 0
};

function updateJoystickBounds() {
    const rect = joystick.getBoundingClientRect();
    joystickBounds.centerX = rect.left + rect.width / 2;
    joystickBounds.centerY = rect.top + rect.height / 2;
}

function handleJoystickStart(e) {
    isJoystickActive = true;
    updateJoystickBounds();
    handleJoystickMove(e);
}

function handleJoystickMove(e) {
    if (!isJoystickActive) return;

    e.preventDefault();
    const touch = e.touches ? e.touches[0] : e;
    
    let dx = touch.clientX - joystickBounds.centerX;
    let dy = touch.clientY - joystickBounds.centerY;
    
    // Calculate distance from center
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Normalize if distance is greater than maxDistance
    if (distance > joystickBounds.maxDistance) {
        dx = (dx / distance) * joystickBounds.maxDistance;
        dy = (dy / distance) * joystickBounds.maxDistance;
    }
    
    // Update stick position
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
    
    // Update joystick data for snake movement
    joystickData.x = dx / joystickBounds.maxDistance;
    joystickData.y = dy / joystickBounds.maxDistance;
}

function handleJoystickEnd() {
    isJoystickActive = false;
    stick.style.transform = 'translate(-50%, -50%)';
    joystickData = { x: 0, y: 0 };
}

// Add touch event listeners
joystick.addEventListener('touchstart', handleJoystickStart);
joystick.addEventListener('touchmove', handleJoystickMove);
joystick.addEventListener('touchend', handleJoystickEnd);
joystick.addEventListener('touchcancel', handleJoystickEnd);

// Also add mouse event listeners for testing on desktop
joystick.addEventListener('mousedown', handleJoystickStart);
document.addEventListener('mousemove', (e) => {
    if (isJoystickActive) handleJoystickMove(e);
});
document.addEventListener('mouseup', handleJoystickEnd);

// Add fullscreen button functionality
const fullscreenButton = document.getElementById('fullscreenButton');

function enterFullscreen(element) {
    const requestFullscreen = element.requestFullscreen || 
                            element.webkitRequestFullscreen || 
                            element.mozRequestFullScreen || 
                            element.msRequestFullscreen;

    // iOS specific handling
    if (navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
        // For iOS, we'll use the standalone mode check
        if (!window.navigator.standalone) {
            alert('To enter fullscreen on iOS, add this page to your home screen and launch it from there.');
            return;
        }
    }

    if (requestFullscreen) {
        requestFullscreen.call(element).catch(err => {
            console.log(`Error attempting to enable fullscreen: ${err.message}`);
            // Try alternative method for mobile
            if (document.body.scrollIntoViewIfNeeded) {
                document.body.scrollIntoViewIfNeeded();
            } else {
                document.body.scrollIntoView();
            }
            screen.orientation.lock('landscape').catch(err => console.log('Orientation lock failed:', err));
        });
    }
}

function exitFullscreen() {
    const exitFullscreen = document.exitFullscreen || 
                          document.webkitExitFullscreen || 
                          document.mozCancelFullScreen || 
                          document.msExitFullscreen;

    if (exitFullscreen) {
        exitFullscreen.call(document).catch(err => 
            console.log(`Error attempting to exit fullscreen: ${err.message}`)
        );
    }
}

fullscreenButton.addEventListener('click', () => {
    if (!document.fullscreenElement && 
        !document.webkitFullscreenElement && 
        !document.mozFullScreenElement && 
        !document.msFullscreenElement) {
        enterFullscreen(document.documentElement);
    } else {
        exitFullscreen();
    }
});

// Update fullscreen button text based on state
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
document.addEventListener('mozfullscreenchange', updateFullscreenButton);
document.addEventListener('MSFullscreenChange', updateFullscreenButton);

function updateFullscreenButton() {
    const isFullscreen = document.fullscreenElement || 
                        document.webkitFullscreenElement || 
                        document.mozFullScreenElement || 
                        document.msFullscreenElement;
    
    fullscreenButton.textContent = isFullscreen ? '↙ Exit Fullscreen' : '⛶ Fullscreen';
}

// Update canvas size function
function updateCanvasSize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// Handle window resize and orientation change
window.addEventListener('resize', updateCanvasSize);
window.addEventListener('orientationchange', updateCanvasSize);

// Initial canvas size
updateCanvasSize();

// Handle fullscreen change
document.addEventListener('fullscreenchange', () => {
    updateCanvasSize();
});

socket.on('playerList', (players) => {
    const playerListHTML = players.map(player => {
        const statusClass = player.ready ? 'ready' : 'not-ready';
        const statusText = player.ready ? 'Ready' : 'Not Ready';
        const masterIcon = player.isRoomMaster ? '<span class="crown-icon">👑 Game Master</span>' : '';
        
        return `
            <div class="player-item">
                <div class="player-name">
                    ${masterIcon}
                    <span>${player.name}</span>
                </div>
                <span class="status-indicator ${statusClass}">${statusText}</span>
            </div>`;
    }).join('');
    
    playerList.innerHTML = playerListHTML;
    
    // Update waiting message
    const allReady = players.every(player => player.ready);
    if (allReady) {
        if (isRoomMaster) {
            waitingMessage.textContent = 'All players ready! Click Start Game to begin!';
        } else {
            waitingMessage.textContent = 'All players ready! Waiting for game master to start...';
        }
        waitingMessage.style.color = '#4CAF50';
    } else {
        const notReadyCount = players.filter(player => !player.ready).length;
        waitingMessage.textContent = `Waiting for ${notReadyCount} player${notReadyCount > 1 ? 's' : ''} to be ready...`;
        waitingMessage.style.color = 'orange';
    }
});

// Add socket event for all players ready
socket.on('allPlayersReady', (ready) => {
    if (isRoomMaster) {
        startGameButton.disabled = !ready;
        startGameButton.style.opacity = ready ? '1' : '0.5';
        waitingMessage.textContent = ready ? 'All players ready! You can start the game!' : 'Waiting for all players to be ready...';
        waitingMessage.style.color = ready ? '#4CAF50' : 'orange';
    }
});

// Add winner announcement div
const winnerDiv = document.createElement('div');
winnerDiv.style.position = 'fixed';
winnerDiv.style.top = '50%';
winnerDiv.style.left = '50%';
winnerDiv.style.transform = 'translate(-50%, -50%)';
winnerDiv.style.background = 'rgba(0, 0, 0, 0.9)';
winnerDiv.style.color = '#4CAF50';
winnerDiv.style.padding = '30px';
winnerDiv.style.borderRadius = '10px';
winnerDiv.style.fontSize = '32px';
winnerDiv.style.fontWeight = 'bold';
winnerDiv.style.textAlign = 'center';
winnerDiv.style.display = 'none';
winnerDiv.style.zIndex = '1000';
winnerDiv.style.border = '3px solid gold';
document.body.appendChild(winnerDiv);

// Add game end socket event
socket.on('gameEnd', (data) => {
    // Clear game timer
    if (gameTimerInterval) {
        clearInterval(gameTimerInterval);
    }
    
    // Stop the snake
    if (snake) {
        snake.isDead = true;
    }
    
    // Hide game over div if it's showing
    gameOverDiv.style.display = 'none';
    
    // Show winner announcement with final leaderboard
    winnerDiv.style.display = 'block';
    const isWinner = data.winner.id === socket.id;

    if (isWinner) {
        playMusic(winMusic, false);
    } else {
        stopAllMusic();
    }

    winnerDiv.innerHTML = `
        <div style="margin-bottom: 20px">
            ${isWinner ? 
                `🎉 Congratulations!<br>You are the king snake now!` :
                `🏆 Game Over!<br>${data.winner.name} is the king snake!`
            }
        </div>
        <div style="
            background: rgba(0, 0, 0, 0.7);
            padding: 15px;
            border-radius: 10px;
            margin-top: 20px;
            font-size: 24px;
        ">
            <div style="color: #FFD700; margin-bottom: 10px;">Final Scores</div>
            ${Object.values(otherPlayers)
                .concat([{name: playerName, score: snake.length - 50}])
                .sort((a, b) => b.score - a.score)
                .slice(1, 5)
                .map((player, index) => `
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        padding: 5px 0;
                        ${player.name === playerName ? 'color: #4CAF50; font-weight: bold;' : 'color: white;'}
                    ">
                        <span>${index + 1}. ${player.name}</span>
                        <span>${player.score}</span>
                    </div>
                `).join('')}
        </div>
        <div style="margin-top: 20px">
            <button onclick="location.reload()" style="
                background: #4CAF50;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 18px;
            ">Play Again</button>
        </div>
    `;
    winnerDiv.style.color = isWinner ? '#FFD700' : '#4CAF50';
}); 