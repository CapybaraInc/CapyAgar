const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 20;
const WORLD_W = 3000;
const WORLD_H = 3000;
const FOOD_COUNT = 250;

// Хранилище комнат
const rooms = {};

// Создаём первую комнату
function createRoom() {
    const id = 'room_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    rooms[id] = {
        id,
        players: {},
        foods: [],
        createdAt: Date.now()
    };
    // Генерируем еду
    for (let i = 0; i < FOOD_COUNT; i++) {
        rooms[id].foods.push({
            id: i,
            x: Math.random() * WORLD_W,
            y: Math.random() * WORLD_H,
            radius: 4 + Math.random() * 5,
            color: ['#FF8C00', '#FFA500', '#FFB347', '#FFD700'][Math.floor(Math.random() * 4)]
        });
    }
    return rooms[id];
}

// Найти или создать комнату
function findOrCreateRoom() {
    // Ищем комнату где меньше 20 игроков
    for (const id in rooms) {
        const room = rooms[id];
        const alive = Object.values(room.players).filter(p => p.alive).length;
        if (alive < MAX_PLAYERS_PER_ROOM) return room;
    }
    return createRoom();
}

// Сервер отдаёт index.html
const server = http.createServer((req, res) => {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, 'utf8', (err, html) => {
        if (err) {
            res.writeHead(500);
            res.end('Error loading game');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    });
});

const wss = new WebSocket.Server({ server });

// ========== ИМЕНА ДЛЯ ИГРОКОВ ==========
const NAMES = [
    '🦫 Капибара', '🦝 Енот', '🦊 Лис', '🐺 Волк', '🐻 Медведь',
    '🐯 Тигр', '🦅 Орёл', '🐊 Крокодил', '🦏 Носорог', '🐗 Кабан',
    '🐸 Жаба', '🦇 Летучая Мышь', '🦀 Краб', '🐍 Змея', '🦔 Ёж',
    '🐿️ Белка', '🦫 Бобёр', '🐹 Хомяк', '🐰 Кролик', '🦨 Скунс'
];

const COLORS = [
    '#8B6914', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F8C471', '#82E0AA', '#F1948A', '#AED6F1', '#FF8C00',
    '#FFD700', '#FFA500', '#FF6347', '#7B68EE', '#00CED1'
];

wss.on('connection', (ws) => {
    const room = findOrCreateRoom();
    const playerId = 'p_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const name = NAMES[Math.floor(Math.random() * NAMES.length)];
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    const player = {
        id: playerId,
        ws,
        roomId: room.id,
        x: 100 + Math.random() * (WORLD_W - 200),
        y: 100 + Math.random() * (WORLD_H - 200),
        mass: 10,
        color,
        name,
        targetX: 0,
        targetY: 0,
        alive: true
    };

    room.players[playerId] = player;
    console.log(`🦫 ${name} зашёл в ${room.id} (${Object.keys(room.players).length} игроков)`);

    // Отправляем игроку его данные
    ws.send(JSON.stringify({
        type: 'welcome',
        data: {
            id: playerId,
            color,
            name,
            roomId: room.id,
            worldWidth: WORLD_W,
            worldHeight: WORLD_H
        }
    }));

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);
            if (msg.type === 'move' && player.alive) {
                player.targetX = msg.x;
                player.targetY = msg.y;
            }
        } catch (e) {}
    });

    ws.on('close', () => {
        player.alive = false;
        // Разбрасываем массу
        const pieces = Math.floor(player.mass / 5);
        for (let i = 0; i < pieces; i++) {
            room.foods.push({
                id: room.foods.length,
                x: player.x + (Math.random() - 0.5) * 100,
                y: player.y + (Math.random() - 0.5) * 100,
                radius: 5,
                color: player.color
            });
        }
        delete room.players[playerId];
        console.log(`💀 ${player.name} вышел из ${room.id}`);
        // Чистим пустые комнаты
        if (Object.keys(room.players).length === 0 && Object.keys(rooms).length > 1) {
            delete rooms[room.id];
            console.log(`🗑️ Комната ${room.id} удалена`);
        }
    });
});

// ========== ИГРОВОЙ ЦИКЛ ==========
function updateRoom(room) {
    const players = Object.values(room.players).filter(p => p.alive);
    if (players.length === 0) return;

    // Движение игроков
    players.forEach(p => {
        const dx = p.targetX - p.x;
        const dy = p.targetY - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 2) {
            const speed = 5 / Math.sqrt(p.mass / 10);
            p.x += (dx / dist) * speed;
            p.y += (dy / dist) * speed;
        }
        const r = Math.sqrt(p.mass) * 3;
        p.x = Math.max(r, Math.min(WORLD_W - r, p.x));
        p.y = Math.max(r, Math.min(WORLD_H - r, p.y));
        if (p.mass > 10) p.mass -= 0.002;

        // Едим еду
        room.foods = room.foods.filter(f => {
            if (Math.hypot(p.x - f.x, p.y - f.y) < r + f.radius) {
                p.mass += 0.5;
                return false;
            }
            return true;
        });
    });

    // Поедание игроков
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const a = players[i], b = players[j];
            if (!a.alive || !b.alive) continue;
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const rA = Math.sqrt(a.mass) * 3, rB = Math.sqrt(b.mass) * 3;
            if (dist < rA + rB - 5) {
                if (a.mass > b.mass * 1.1) {
                    a.mass += b.mass * 0.6;
                    b.alive = false;
                    b.ws.send(JSON.stringify({ type: 'dead' }));
                    delete room.players[b.id];
                } else if (b.mass > a.mass * 1.1) {
                    b.mass += a.mass * 0.6;
                    a.alive = false;
                    a.ws.send(JSON.stringify({ type: 'dead' }));
                    delete room.players[a.id];
                }
            }
        }
    }

    // Доспавн еды
    while (room.foods.length < FOOD_COUNT) {
        room.foods.push({
            id: room.foods.length,
            x: Math.random() * WORLD_W,
            y: Math.random() * WORLD_H,
            radius: 4 + Math.random() * 5,
            color: ['#FF8C00', '#FFA500', '#FFB347', '#FFD700'][Math.floor(Math.random() * 4)]
        });
    }

    // Отправка состояния
    const state = {
        players: Object.values(room.players).filter(p => p.alive).map(p => ({
            id: p.id,
            x: p.x,
            y: p.y,
            mass: p.mass,
            color: p.color,
            name: p.name
        })),
        foods: room.foods.slice(0, 300)
    };

    const msg = JSON.stringify({ type: 'state', data: state });
    Object.values(room.players).forEach(p => {
        if (p.ws.readyState === WebSocket.OPEN) {
            try { p.ws.send(msg); } catch (e) {}
        }
    });
}

// Обновляем все комнаты
setInterval(() => {
    Object.values(rooms).forEach(updateRoom);
}, 1000 / 30);

server.listen(PORT, () => {
    console.log(`🦫🍊 CapyAgar сервер на порту ${PORT}`);
    console.log(`👥 До ${MAX_PLAYERS_PER_ROOM} игроков в комнате`);
    createRoom();
});
