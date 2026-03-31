// 女巫的毒药 - WebSocket 游戏服务器
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

// 游戏配置
const CONFIG = {
    MIN_PLAYERS: 3,
    MAX_PLAYERS: 6,
    INITIAL_GOLD: 3,
    INITIAL_HAND_SIZE: 3,
    MAX_ROUNDS: 20
};

// 卡牌数据
const CARD_DATA = {
    materials: {
        poison: { subtype: 'danger', price: 2 },
        antidote: { subtype: 'heal', price: 2 },
        herb: { subtype: 'heal', price: 1 },
        cookie: { subtype: 'food', price: 1 },
        candy: { subtype: 'food', price: 1 },
        donut: { subtype: 'food', price: 1 },
        lollipop: { subtype: 'food', price: 1 },
        apple_pie: { subtype: 'food', price: 1 },
        apple: { subtype: 'danger', price: 2 }
    },
    skills: {
        energy_drink: { subtype: 'buff', price: 2 },
        magnifier: { subtype: 'special', price: 1 },
        amulet: { subtype: 'defense', price: 3 },
        gold: { subtype: 'resource', price: 0 },
        luck: { subtype: 'buff', price: 1 },
        power: { subtype: 'buff', price: 2 },
        swap: { subtype: 'special', price: 2 },
        steal: { subtype: 'special', price: 2 },
        peek: { subtype: 'special', price: 1 }
    }
};

// 生成抽牌堆
function generateDrawDeck() {
    const deck = [];
    
    // 材料牌配置
    const materialConfig = {
        poison: 3, antidote: 2, herb: 3, cookie: 2,
        candy: 2, donut: 2, lollipop: 1, apple_pie: 1, apple: 2
    };
    
    // 技能牌配置
    const skillConfig = {
        energy_drink: 2, magnifier: 1, amulet: 1, gold: 2,
        luck: 1, power: 1, swap: 1, steal: 1, peek: 1
    };
    
    for (const [id, count] of Object.entries(materialConfig)) {
        for (let i = 0; i < count; i++) deck.push(id);
    }
    
    for (const [id, count] of Object.entries(skillConfig)) {
        for (let i = 0; i < count; i++) deck.push(id);
    }
    
    return shuffle(deck);
}

// Fisher-Yates 洗牌
function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// 生成房间号
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// 房间类
class Room {
    constructor(code, hostId, maxPlayers, gameMode) {
        this.code = code;
        this.hostId = hostId;
        this.maxPlayers = maxPlayers;
        this.gameMode = gameMode;
        this.players = new Map();
        this.gameStarted = false;
        this.gameState = null;
        this.createdAt = Date.now();
    }
    
    addPlayer(ws, name) {
        if (this.players.size >= this.maxPlayers) {
            return null;
        }
        
        const playerId = uuidv4();
        const player = {
            id: playerId,
            ws,
            name,
            hand: [],
            gold: CONFIG.INITIAL_GOLD,
            alive: true,
            hasShield: false,
            ready: false
        };
        
        this.players.set(playerId, player);
        return player;
    }
    
    removePlayer(playerId) {
        this.players.delete(playerId);
        
        // 如果房主离开，转移给下一个玩家
        if (this.hostId === playerId && this.players.size > 0) {
            this.hostId = this.players.keys().next().value;
        }
        
        // 如果房间空了，删除房间
        if (this.players.size === 0) {
            return true; // 删除房间
        }
        
        // 广播更新
        this.broadcastRoomUpdate();
        return false;
    }
    
    isHost(playerId) {
        return this.hostId === playerId;
    }
    
    canStart() {
        return this.players.size >= CONFIG.MIN_PLAYERS && 
               this.players.size <= CONFIG.MAX_PLAYERS;
    }
    
    startGame() {
        if (!this.canStart()) return false;
        
        this.gameStarted = true;
        const deck = generateDrawDeck();
        
        // 初始化玩家手牌
        let cardIndex = 0;
        for (const [id, player] of this.players) {
            player.hand = deck.slice(cardIndex, cardIndex + CONFIG.INITIAL_HAND_SIZE);
            cardIndex += CONFIG.INITIAL_HAND_SIZE;
        }
        
        this.gameState = {
            deck: deck.slice(cardIndex),
            discardPile: [],
            pot: [],
            currentTurnPlayerId: this.hostId,
            round: 1,
            phase: 'draw'
        };
        
        return true;
    }
    
    broadcast(message, excludePlayerId = null) {
        for (const [id, player] of this.players) {
            if (id !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify(message));
            }
        }
    }
    
    broadcastRoomUpdate() {
        const playerList = [];
        for (const [id, player] of this.players) {
            playerList.push({
                id: player.id,
                name: player.name,
                ready: player.ready,
                isHost: id === this.hostId
            });
        }
        
        this.broadcast({
            type: 'room_update',
            players: playerList,
            maxPlayers: this.maxPlayers
        });
    }
    
    sendToPlayer(playerId, message) {
        const player = this.players.get(playerId);
        if (player && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(message));
        }
    }
    
    getPlayerList() {
        const list = [];
        for (const [id, player] of this.players) {
            list.push({
                id: player.id,
                name: player.name,
                ready: player.ready,
                alive: player.alive,
                gold: player.gold,
                handCount: player.hand.length,
                hasShield: player.hasShield
            });
        }
        return list;
    }
}

// 游戏服务器
class GameServer {
    constructor() {
        this.wss = null;
        this.rooms = new Map();
        this.players = new Map(); // playerId -> { roomCode, ws }
    }
    
    start(port) {
        this.wss = new WebSocket.Server({ port });
        
        console.log(`🎮 游戏服务器启动在端口 ${port}`);
        
        this.wss.on('connection', (ws) => {
            console.log('🔗 新连接');
            
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    this.handleMessage(ws, message);
                } catch (e) {
                    console.error('消息解析错误:', e);
                }
            });
            
            ws.on('close', () => {
                this.handleDisconnect(ws);
            });
            
            ws.on('error', (error) => {
                console.error('WebSocket错误:', error);
            });
        });
        
        // 清理过期房间（1小时无活动）
        setInterval(() => this.cleanupRooms(), 3600000);
    }
    
    handleMessage(ws, message) {
        const { type, ...data } = message;
        
        switch (type) {
            case 'login':
                this.handleLogin(ws, data);
                break;
            case 'create_room':
                this.handleCreateRoom(ws, data);
                break;
            case 'join_room':
                this.handleJoinRoom(ws, data);
                break;
            case 'leave_room':
                this.handleLeaveRoom(ws);
                break;
            case 'ready':
                this.handleReady(ws);
                break;
            case 'start_game':
                this.handleStartGame(ws);
                break;
            case 'draw_card':
                this.handleDrawCard(ws);
                break;
            case 'play_card':
                this.handlePlayCard(ws, data);
                break;
            case 'use_skill':
                this.handleUseSkill(ws, data);
                break;
            case 'buy_item':
                this.handleBuyItem(ws, data);
                break;
            case 'end_turn':
                this.handleEndTurn(ws);
                break;
            default:
                console.log('未知消息类型:', type);
        }
    }
    
    handleLogin(ws, { nickname }) {
        const playerId = uuidv4();
        ws.playerId = playerId;
        ws.nickname = nickname;
        
        this.players.set(playerId, { ws, roomCode: null });
        
        ws.send(JSON.stringify({
            type: 'login',
            playerId
        }));
        
        console.log(`✅ 玩家登录: ${nickname} (${playerId})`);
    }
    
    handleCreateRoom(ws, { maxPlayers, gameMode }) {
        if (!ws.playerId) {
            return ws.send(JSON.stringify({ type: 'error', message: '请先登录' }));
        }
        
        // 生成唯一房间号
        let roomCode;
        do {
            roomCode = generateRoomCode();
        } while (this.rooms.has(roomCode));
        
        // 创建房间
        const room = new Room(roomCode, ws.playerId, maxPlayers, gameMode);
        room.addPlayer(ws, ws.nickname);
        this.rooms.set(roomCode, room);
        
        // 更新玩家信息
        this.players.get(ws.playerId).roomCode = roomCode;
        
        // 发送房间信息
        ws.send(JSON.stringify({
            type: 'room_created',
            roomCode,
            maxPlayers,
            gameMode,
            players: room.getPlayerList()
        }));
        
        console.log(`🏠 房间创建: ${roomCode} by ${ws.nickname}`);
    }
    
    handleJoinRoom(ws, { roomCode, nickname }) {
        if (!ws.playerId) {
            return ws.send(JSON.stringify({ type: 'error', message: '请先登录' }));
        }
        
        const room = this.rooms.get(roomCode);
        
        if (!room) {
            return ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        }
        
        if (room.gameStarted) {
            return ws.send(JSON.stringify({ type: 'error', message: '游戏已开始' }));
        }
        
        if (room.players.size >= room.maxPlayers) {
            return ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
        }
        
        // 加入房间
        const player = room.addPlayer(ws, nickname || ws.nickname);
        if (!player) {
            return ws.send(JSON.stringify({ type: 'error', message: '加入房间失败' }));
        }
        
        // 更新玩家信息
        this.players.get(ws.playerId).roomCode = roomCode;
        
        // 发送房间信息给新玩家
        ws.send(JSON.stringify({
            type: 'room_joined',
            roomCode,
            maxPlayers: room.maxPlayers,
            gameMode: room.gameMode,
            players: room.getPlayerList(),
            isHost: false
        }));
        
        // 广播其他玩家
        room.broadcast({
            type: 'player_joined',
            playerId: player.id,
            playerName: player.name
        }, ws.playerId);
        
        console.log(`👤 ${player.name} 加入房间 ${roomCode}`);
    }
    
    handleLeaveRoom(ws) {
        const playerInfo = this.players.get(ws.playerId);
        if (!playerInfo || !playerInfo.roomCode) return;
        
        const room = this.rooms.get(playerInfo.roomCode);
        if (!room) return;
        
        const shouldDelete = room.removePlayer(ws.playerId);
        
        room.broadcast({
            type: 'player_left',
            playerId: ws.playerId
        });
        
        if (shouldDelete) {
            this.rooms.delete(playerInfo.roomCode);
            console.log(`🗑️ 房间 ${playerInfo.roomCode} 已删除`);
        }
        
        playerInfo.roomCode = null;
    }
    
    handleReady(ws) {
        const playerInfo = this.players.get(ws.playerId);
        if (!playerInfo || !playerInfo.roomCode) return;
        
        const room = this.rooms.get(playerInfo.roomCode);
        if (!room) return;
        
        const player = room.players.get(ws.playerId);
        if (player) {
            player.ready = !player.ready;
            room.broadcastRoomUpdate();
        }
    }
    
    handleStartGame(ws) {
        const playerInfo = this.players.get(ws.playerId);
        if (!playerInfo || !playerInfo.roomCode) return;
        
        const room = this.rooms.get(playerInfo.roomCode);
        if (!room) return;
        
        if (!room.isHost(ws.playerId)) {
            return ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏' }));
        }
        
        if (!room.startGame()) {
            return ws.send(JSON.stringify({ type: 'error', message: '无法开始游戏' }));
        }
        
        // 给每个玩家发送初始手牌
        for (const [id, player] of room.players) {
            player.ws.send(JSON.stringify({
                type: 'game_start',
                drawDeck: player.hand, // 只发送自己的手牌
                players: room.getPlayerList(),
                maxPlayers: room.maxPlayers
            }));
        }
        
        console.log(`🎮 房间 ${room.code} 游戏开始！`);
    }
    
    handleDrawCard(ws) {
        const playerInfo = this.players.get(ws.playerId);
        if (!playerInfo || !playerInfo.roomCode) return;
        
        const room = this.rooms.get(playerInfo.roomCode);
        if (!room || !room.gameStarted) return;
        
        const player = room.players.get(ws.playerId);
        if (!player || !player.alive) return;
        
        // 检查是否是当前玩家
        if (room.gameState.currentTurnPlayerId !== ws.playerId) {
            return ws.send(JSON.stringify({ type: 'error', message: '还没轮到你' }));
        }
        
        // 抽牌
        if (room.gameState.deck.length === 0) {
            // 洗牌弃牌堆
            room.gameState.deck = shuffle(room.gameState.discardPile);
            room.gameState.discardPile = [];
        }
        
        if (room.gameState.deck.length > 0) {
            const card = room.gameState.deck.pop();
            player.hand.push(card);
            room.gameState.phase = 'action';
            
            ws.send(JSON.stringify({
                type: 'card_drawn',
                card,
                deckCount: room.gameState.deck.length
            }));
        }
    }
    
    handlePlayCard(ws, { cardId }) {
        const playerInfo = this.players.get(ws.playerId);
        if (!playerInfo || !playerInfo.roomCode) return;
        
        const room = this.rooms.get(playerInfo.roomCode);
        if (!room || !room.gameStarted) return;
        
        const player = room.players.get(ws.playerId);
        if (!player || !player.alive) return;
        
        // 找到并移除手牌
        const cardIndex = player.hand.indexOf(cardId);
        if (cardIndex === -1) {
            return ws.send(JSON.stringify({ type: 'error', message: '你没有这张牌' }));
        }
        
        player.hand.splice(cardIndex, 1);
        room.gameState.pot.push(cardId);
        
        // 广播出牌
        room.broadcast({
            type: 'card_played',
            playerId: ws.playerId,
            playerName: player.name,
            card: cardId,
            pot: room.gameState.pot
        }, ws.playerId);
        
        ws.send(JSON.stringify({
            type: 'card_played',
            card: cardId,
            pot: room.gameState.pot
        }));
    }
    
    handleUseSkill(ws, { cardId, targetId }) {
        const playerInfo = this.players.get(ws.playerId);
        if (!playerInfo || !playerInfo.roomCode) return;
        
        const room = this.rooms.get(playerInfo.roomCode);
        if (!room || !room.gameStarted) return;
        
        const player = room.players.get(ws.playerId);
        if (!player || !player.alive) return;
        
        // 检查是否有这张技能牌
        const cardIndex = player.hand.indexOf(cardId);
        if (cardIndex === -1) {
            return ws.send(JSON.stringify({ type: 'error', message: '你没有这张牌' }));
        }
        
        const cardCategory = CARD_DATA.skills[cardId];
        if (!cardCategory) {
            return ws.send(JSON.stringify({ type: 'error', message: '这不是技能牌' }));
        }
        
        // 处理技能效果
        let result = { success: true };
        
        switch (cardId) {
            case 'gold':
                player.gold += 2;
                player.hand.splice(cardIndex, 1);
                room.gameState.discardPile.push(cardId);
                result = { action: 'add_gold', amount: 2 };
                break;
                
            case 'amulet':
                player.hasShield = true;
                player.hand.splice(cardIndex, 1);
                room.gameState.discardPile.push(cardId);
                result = { action: 'add_shield' };
                break;
                
            case 'energy_drink':
                player.hand.splice(cardIndex, 1);
                room.gameState.discardPile.push(cardId);
                result = { action: 'extra_turn' };
                break;
                
            case 'magnifier':
                result = { action: 'peek_pot', pot: room.gameState.pot };
                break;
                
            case 'peek':
                const target = room.players.get(targetId);
                if (target) {
                    result = { action: 'peek_hand', hand: target.hand };
                }
                break;
                
            default:
                player.hand.splice(cardIndex, 1);
                room.gameState.discardPile.push(cardId);
        }
        
        ws.send(JSON.stringify({
            type: 'skill_used',
            card: cardId,
            ...result
        }));
        
        room.broadcast({
            type: 'skill_used',
            playerId: ws.playerId,
            playerName: player.name,
            card: cardId
        }, ws.playerId);
    }
    
    handleBuyItem(ws, { cardId }) {
        const playerInfo = this.players.get(ws.playerId);
        if (!playerInfo || !playerInfo.roomCode) return;
        
        const room = this.rooms.get(playerInfo.roomCode);
        if (!room || !room.gameStarted) return;
        
        const player = room.players.get(ws.playerId);
        if (!player || !player.alive) return;
        
        // 检查价格
        let price = 1;
        if (CARD_DATA.materials[cardId]) {
            price = CARD_DATA.materials[cardId].price;
        } else if (CARD_DATA.skills[cardId]) {
            price = CARD_DATA.skills[cardId].price;
        }
        
        if (player.gold < price) {
            return ws.send(JSON.stringify({ type: 'error', message: '金币不足' }));
        }
        
        player.gold -= price;
        
        // 从牌堆抽取
        if (room.gameState.deck.length > 0) {
            const card = room.gameState.deck.pop();
            player.hand.push(card);
            
            ws.send(JSON.stringify({
                type: 'item_bought',
                card,
                price,
                remainingGold: player.gold
            }));
        }
    }
    
    handleEndTurn(ws) {
        const playerInfo = this.players.get(ws.playerId);
        if (!playerInfo || !playerInfo.roomCode) return;
        
        const room = this.rooms.get(playerInfo.roomCode);
        if (!room || !room.gameStarted) return;
        
        if (room.gameState.currentTurnPlayerId !== ws.playerId) {
            return ws.send(JSON.stringify({ type: 'error', message: '还没轮到你' }));
        }
        
        // 检查锅中是否有毒药
        const hasPoison = room.gameState.pot.some(cardId => {
            const mat = CARD_DATA.materials[cardId];
            return mat && mat.subtype === 'danger';
        });
        
        // 检查是否有解药
        const hasAntidote = room.gameState.pot.includes('antidote');
        
        // 检查是否有力量药剂（跳过效果）
        const hasPower = room.gameState.pot.includes('power');
        
        let eliminatedPlayer = null;
        
        if (hasPoison && !hasPower) {
            // 找到下一个玩家（受害者）
            const playerIds = Array.from(room.players.keys());
            const currentIndex = playerIds.indexOf(ws.playerId);
            const nextIndex = (currentIndex + 1) % playerIds.length;
            const nextPlayerId = playerIds[nextIndex];
            const nextPlayer = room.players.get(nextPlayerId);
            
            if (nextPlayer && nextPlayer.alive) {
                if (hasAntidote) {
                    // 解药抵消毒药
                    nextPlayer.hasShield = true;
                } else if (!nextPlayer.hasShield) {
                    // 中毒死亡
                    nextPlayer.alive = false;
                    eliminatedPlayer = nextPlayer;
                } else {
                    // 护盾抵消毒药
                    nextPlayer.hasShield = false;
                }
            }
        }
        
        // 清空锅中
        room.gameState.discardPile.push(...room.gameState.pot);
        room.gameState.pot = [];
        
        // 移动到下一个玩家
        let nextPlayerId = this.getNextAlivePlayer(room, ws.playerId);
        room.gameState.currentTurnPlayerId = nextPlayerId;
        
        // 检查回合
        if (nextPlayerId === room.getPlayerList().find(p => p.alive)?.id || 
            room.gameState.round === 1) {
            room.gameState.round++;
        }
        
        // 检查游戏是否结束
        const alivePlayers = Array.from(room.players.values()).filter(p => p.alive);
        
        if (alivePlayers.length <= 1 || room.gameState.round > CONFIG.MAX_ROUNDS) {
            // 游戏结束
            const winner = alivePlayers.sort((a, b) => b.gold - a.gold)[0];
            
            for (const [id, p] of room.players) {
                p.ws.send(JSON.stringify({
                    type: 'game_end',
                    winner: winner ? { id: winner.id, name: winner.name } : null,
                    players: room.getPlayerList()
                }));
            }
            
            console.log(`🏆 游戏结束！胜利者: ${winner?.name}`);
        } else {
            // 广播回合信息
            const nextPlayer = room.players.get(nextPlayerId);
            room.broadcast({
                type: 'turn_end',
                eliminated: eliminatedPlayer ? { id: eliminatedPlayer.id, name: eliminatedPlayer.name } : null,
                nextPlayerId,
                round: room.gameState.round
            });
            
            nextPlayer.ws.send(JSON.stringify({
                type: 'turn_start',
                playerId: nextPlayerId,
                playerName: nextPlayer.name,
                phase: 'draw'
            }));
        }
    }
    
    getNextAlivePlayer(room, currentPlayerId) {
        const playerIds = Array.from(room.players.keys());
        let nextIndex = playerIds.indexOf(currentPlayerId) + 1;
        
        for (let i = 0; i < playerIds.length; i++) {
            const checkIndex = (nextIndex + i) % playerIds.length;
            const player = room.players.get(playerIds[checkIndex]);
            if (player && player.alive) {
                return playerIds[checkIndex];
            }
        }
        
        return currentPlayerId;
    }
    
    handleDisconnect(ws) {
        console.log('🔌 连接断开');
        
        if (ws.playerId) {
            const playerInfo = this.players.get(ws.playerId);
            if (playerInfo && playerInfo.roomCode) {
                this.handleLeaveRoom(ws);
            }
            this.players.delete(ws.playerId);
        }
    }
    
    cleanupRooms() {
        const now = Date.now();
        for (const [code, room] of this.rooms) {
            if (now - room.createdAt > 3600000 && room.players.size === 0) {
                this.rooms.delete(code);
                console.log(`🧹 清理过期房间: ${code}`);
            }
        }
    }
}

// 启动服务器
const server = new GameServer();
server.start(PORT);
