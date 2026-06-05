// ============================================
// CapyAgar Server - WebSocket мультиплеер
// ============================================
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 3000;
const FOOD_COUNT = 300;
const TICK_RATE = 1000 / 30; // 30 обновлений в секунду

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('CapyAgar Server Running');
});

const wss = new WebSocket.Server({ server });

// ========== ИГРОВОЕ СОСТОЯНИЕ СЕРВЕРА ==========
let players = {};
let foods = [];
let nextPlayerId = 1;

const COLORS = [
    '#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7',
    '#DDA0DD','#98D8C8','#F7DC6F','#BB8FCE','#85C1E9',
    '#F8C471','#82E0AA','#F1948A','#AED6F1','#FF8C00',
    '#FFD700','#FFA500','#FF6347','#7B68EE','#00CED1'
];

const ANIMAL_NAMES = [
    '🦝 Енот','🦊 Лис','🦔 Ёж','🐺 Волк','🐍 Змея',
    '🦇 Мышь','🦀 Краб','🐗 Кабан','🐸 Жаба','🦅 Орёл',
    '🐊 Крокодил','🐯 Тигр','🐻 Медведь','🦏 Носорог','🦛 Бегемот'
];

// ========== ГЕНЕРАЦИЯ ЕДЫ ==========
function spawnFood() {
    foods = [];
    for (let i = 0; i < FOOD_COUNT; i++) {
        foods.push({
            id: i,
            x: Math.random() * WORLD_WIDTH,
            y: Math.random() * WORLD_HEIGHT,
            radius: Math.random() * 4 + 4,
            color: ['#FF8C00','#FFA500','#FFB347','#FFD700','#FFC107'][Math.floor(Math.random()*5)],
            type: Math.random() < 0.05 ? 'big' : 'normal'
        });
    }
}

// ========== СОЗДАНИЕ ИГРОКА ==========
function createPlayer(ws) {
    const id = nextPlayerId++;
    const name = ANIMAL_NAMES[Math.floor(Math.random() * ANIMAL_NAMES.length)];
    const player = {
        id,
        ws,
        x: Math.random() * WORLD_WIDTH,
        y: Math.random() * WORLD_HEIGHT,
        mass: 10,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        name,
        targetX: 0,
        targetY: 0,
        alive: true
    };
    players[id] = player;
    console.log(`🦫 Игрок #${id} (${name}) подключился. Всего: ${Object.keys(players).length}`);
    return player;
}

// ========== УДАЛЕНИЕ ИГРОКА ==========
function removePlayer(id) {
    if (players[id]) {
        console.log(`💀 Игрок #${id} отключился`);
        // Разбрасываем массу как еду
        const p = players[id];
        const pieces = Math.floor(p.mass / 5);
        for (let i = 0; i < pieces; i++) {
            foods.push({
                id: foods.length,
                x: p.x + (Math.random() - 0.5) * 100,
                y: p.y + (Math.random() - 0.5) * 100,
                radius: 5,
                color: p.color,
                type: 'player_drop'
            });
        }
        delete players[id];
    }
}

// ========== ОБНОВЛЕНИЕ ИГРОКОВ ==========
function updatePlayers() {
    const playerList = Object.values(players).filter(p => p.alive);

    playerList.forEach(player => {
        // Движение к цели
        const dx = player.targetX - player.x;
        const dy = player.targetY - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 2) {
            const speed = 5 / Math.sqrt(player.mass / 10);
            player.x += (dx / dist) * speed;
            player.y += (dy / dist) * speed;
        }

        // Границы мира
        const r = Math.sqrt(player.mass) * 3;
        player.x = Math.max(r, Math.min(WORLD_WIDTH - r, player.x));
        player.y = Math.max(r, Math.min(WORLD_HEIGHT - r, player.y));

        // Потеря массы
        if (player.mass > 10) player.mass -= 0.002;
    });

    // Поедание еды
    playerList.forEach(player => {
        const r = Math.sqrt(player.mass) * 3;
        foods = foods.filter(food => {
            const dist = Math.hypot(player.x - food.x, player.y - food.y);
            if (dist < r + food.radius - 2) {
                player.mass += food.type === 'big' ? 2 : 0.5;
                return false;
            }
            return true;
        });
    });

    // Поедание игроков
    for (let i = 0; i < playerList.length; i++) {
        for (let j = i + 1; j < playerList.length; j++) {
            const a = playerList[i];
            const b = playerList[j];
            if (!a.alive || !b.alive) continue;
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const rA = Math.sqrt(a.mass) * 3;
            const rB = Math.sqrt(b.mass) * 3;
            if (dist < rA + rB - 5) {
                if (a.mass > b.mass * 1.1) {
                    a.mass += b.mass * 0.6;
                    b.alive = false;
                    removePlayer(b.id);
                } else if (b.mass > a.mass * 1.1) {
                    b.mass += a.mass * 0.6;
                    a.alive = false;
                    removePlayer(a.id);
                }
            }
        }
    }

    // Доспавн еды
    if (foods.length < FOOD_COUNT) {
        for (let i = 0; i < FOOD_COUNT - foods.length; i++) {
            foods.push({
                id: foods.length,
                x: Math.random() * WORLD_WIDTH,
                y: Math.random() * WORLD_HEIGHT,
                radius: Math.random() * 4 + 4,
                color: ['#FF8C00','#FFA500','#FFB347','#FFD700'][Math.floor(Math.random()*4)],
                type: 'normal'
            });
        }
    }
}

// ========== ОТПРАВКА СОСТОЯНИЯ ==========
function broadcastState() {
    const alivePlayers = Object.values(players).filter(p => p.alive);
    const leaderboard = alivePlayers
        .sort((a, b) => b.mass - a.mass)
        .slice(0, 10)
        .map(p => ({ id: p.id, name: p.name, mass: Math.floor(p.mass), color: p.color }));

    const gameState = {
        players: alivePlayers.map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            mass: p.mass,
            color: p.color,
            name: p.name
        })),
        foods: foods.slice(0, 400), // Ограничиваем для производительности
        leaderboard,
        worldWidth: WORLD_WIDTH,
        worldHeight: WORLD_HEIGHT
    };

    const message = JSON.stringify({ type: 'state', data: gameState });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(message);
            } catch (e) {
                // Игнорируем ошибки отправки
            }
        });
    });
}

// ========== WEBSOCKET ОБРАБОТЧИКИ ==========
wss.on('connection', (ws) => {
    const player = createPlayer(ws);

    // Отправляем ID игроку
    ws.send(JSON.stringify({
        type: 'init',
        data: { id: player.id, color: player.color, name: player.name }
    }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            if (msg.type === 'move' && player.alive) {
                player.targetX = msg.x;
                player.targetY = msg.y;
            }
        } catch (e) {
            // Игнорируем битые сообщения
        }
    });

    ws.on('close', () => {
        removePlayer(player.id);
    });

    ws.on('error', () => {
        removePlayer(player.id);
    });
});

// ========== ЗАПУСК ==========
spawnFood();
setInterval(updatePlayers, TICK_RATE);
setInterval(broadcastState, 1000 / 20); // 20 fps для клиентов

server.listen(PORT, () => {
    console.log(`🦫🍊 CapyAgar Server на порту ${PORT}`);
    console.log(`🌍 Мир: ${WORLD_WIDTH}x${WORLD_HEIGHT}`);
    console.log(`🍊 Еды: ${FOOD_COUNT}`);
});
