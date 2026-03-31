// 女巫的毒药 - WebSocket 游戏服务器
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

// ========== 游戏常量 ==========
const CONFIG = {
    INITIAL_POINTS: 3,
    BUY_COST: 5,
    TURN_TIMEOUT: 15,
    GRID_SIZE: 5,
    FOOD_COUNT: 25,
    ITEM_COUNT: 24,
    ROLE_COUNT: 10,
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 4
};

// ========== 卡牌数据 ==========
const CARD_DATA = {
    foods: [
        { id: 'apple', name: '苹果', count: 6, points: 1, special: null },
        { id: 'apple_pie', name: '苹果派', count: 3, points: 2, special: null },
        { id: 'lollipop', name: '棒棒糖', count: 2, points: 0, special: 'steal_3' },
        { id: 'donut', name: '甜甜圈', count: 2, points: 3, special: null },
        { id: 'candy', name: '糖果', count: 1, points: 5, special: null },
        { id: 'magnifier', name: '放大镜', count: 2, points: 0, special: 'peek_one' },
        { id: 'herb', name: '魔法草药', count: 2, points: 0, special: 'draw_item' },
        { id: 'cookie', name: '曲奇饼干', count: 2, points: 0, special: 'double_points' },
        { id: 'energy_drink', name: '能量饮料', count: 2, points: 0, special: 'extra_flip' },
        { id: 'poison', name: '女巫的毒药', count: 3, points: 0, special: 'death' }
    ],
    items: [
        { id: 'gold', name: '点石成金', count: 3, points: 7 },
        { id: 'steal', name: '妙手空空', count: 3, special: 'steal_3' },
        { id: 'lucky', name: '强运甘露', count: 3, special: 'choose_two' },
        { id: 'force', name: '力量药水', count: 3, special: 'force_flip' },
        { id: 'amulet', name: '护身符', count: 3, special: 'shield' },
        { id: 'swap', name: '移形换影', count: 3, special: 'swap_cards' },
        { id: 'antidote', name: '解毒剂', count: 3, special: 'cure' },
        { id: 'peek', name: '窥视', count: 3, special: 'peek_three' }
    ],
    roles: [
        { id: 'innocent', name: '纯白之女', skill: 'reshuffle' },
        { id: 'scholar', name: '学者', skill: 'bonus_5' },
        { id: 'elder', name: '长老', skill: 'choose_two' },
        { id: 'maid', name: '女仆', skill: 'extra_item' },
        { id: 'girl', name: '小女孩', skill: 'discount' },
        { id: 'archer', name: '弓箭手', skill: 'double_flip' },
        { id: 'graveyard', name: '守墓人', skill: 'cure' },
        { id: 'magician', name: '魔术师', skill: 'peek_one' },
        { id: 'rogue', name: '老流氓', skill: 'steal_3' },
        { id: 'skip', name: '少女', skill: 'skip_turn' }
    ]
};

// ========== 工具函数 ==========
function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function generateFoodDeck() {
    const deck = [];
    for (const food of CARD_DATA.foods) {
        for (let i = 0; i < food.count; i++) {
            deck.push({ type: 'food', id: food.id, revealed: false });
        }
    }
    return shuffle(deck);
}

function generateItemDeck() {
    const deck = [];
    for (const item of CARD_DATA.items) {
        for (let i = 0; i < item.count; i++) {
            deck.push({ type: 'item', id: item.id });
        }
    }
    return shuffle(deck);
}

function assignRoles(playerCount) {
    const roles = shuffle([...CARD_DATA.roles]);
    return roles.slice(0, playerCount);
}

// ========== 房间类 ==========
class Room {
    constructor(code, hostId, maxPlayers) {
        this.code = code;
        this.hostId = hostId;
        this.maxPlayers = maxPlayers;
        this.players = new Map();
        this.gameStarted = false;
        this.foodDeck = [];
        this.itemDeck = [];
        this.discardDeck = [];
        this.foodCards = [];
        this.currentTurnIndex = 0;
        this.turnPhase = 'waiting';
        this.round = 1;
        this.turnStartTime = 0;
        this.doubleNext = {};
        this.createdAt = Date.now();
        this.autoStartTimer = null;
        this.AUTO_START_DELAY = 3000; // 3秒后自动开始（玩家>=2人）
    }
    
    addPlayer(ws, name) {
        if (this.players.size >= this.maxPlayers) return null;
        // 使用 WebSocket 上已有的 playerId（登录时创建的）
        const id = ws.playerId;
        const player = {
            id, ws, name,
            points: CONFIG.INITIAL_POINTS,
            role: null,
            items: [],
            alive: true,
            roleUsed: false,
            hasShield: false
        };
        this.players.set(id, player);
        return player;
    }
    
    removePlayer(id) {
        this.players.delete(id);
        if (this.hostId === id && this.players.size > 0) {
            this.hostId = this.players.keys().next().value;
        }
        if (this.players.size === 0) {
            this.clearAutoStartTimer();
            return true;
        }
        this.broadcastRoomUpdate();
        // 如果玩家>=2，尝试自动开始
        this.tryAutoStart();
        return false;
    }
    
    // 自动开始游戏
    tryAutoStart() {
        if (this.gameStarted) return;
        if (this.players.size >= CONFIG.MIN_PLAYERS) {
            this.clearAutoStartTimer();
            this.autoStartTimer = setTimeout(() => {
                if (!this.gameStarted && this.players.size >= CONFIG.MIN_PLAYERS) {
                    console.log(`房间 ${this.code} 自动开始游戏`);
                    this.startGame();
                }
            }, this.AUTO_START_DELAY);
        }
    }
    
    clearAutoStartTimer() {
        if (this.autoStartTimer) {
            clearTimeout(this.autoStartTimer);
            this.autoStartTimer = null;
        }
    }
    
    isHost(id) { return this.hostId === id; }
    
    canStart() {
        return this.players.size >= CONFIG.MIN_PLAYERS;
    }
    
    startGame() {
        if (!this.canStart()) return false;
        this.gameStarted = true;
        this.foodDeck = generateFoodDeck();
        this.itemDeck = generateItemDeck();
        this.discardDeck = [];
        this.foodCards = this.foodDeck.splice(0, CONFIG.FOOD_COUNT);
        
        // 分配角色
        const roles = assignRoles(this.players.size);
        let i = 0;
        for (const [id, player] of this.players) {
            player.role = roles[i];
            i++;
        }
        
        // 应用学者效果（开局+5积分）
        for (const [id,player] of this.players) {
            if (player.role?.id === 'scholar') {
                player.points += 5;
            }
            // 女仆效果：额外1张道具
            if (player.role?.id === 'maid' && this.itemDeck.length > 0) {
                player.items.push(this.itemDeck.pop());
            }
        }
        
        // 随机开始玩家
        this.currentTurnIndex = Math.floor(Math.random() * this.players.size);
        this.turnPhase = 'flip';
        this.round = 1;
        this.turnStartTime = Date.now();
        
        return true;
    }
    
    getCurrentPlayer() {
        return Array.from(this.players.values())[this.currentTurnIndex];
    }
    
    getAlivePlayers() {
        return Array.from(this.players.values()).filter(p => p.alive);
    }
    
    getNextAliveIndex() {
        const players = Array.from(this.players.values());
        for (let i = 1; i < players.length; i++) {
            const idx = (this.currentTurnIndex + i) % players.length;
            if (players[idx].alive) return idx;
        }
        return this.currentTurnIndex;
    }
    
    flipCard(playerId, position) {
        const player = this.players.get(playerId);
        if (!player || !player.alive) return { error: '无效玩家' };
        if (this.getCurrentPlayer().id !== playerId) return { error: '不是你的回合' };
        if (this.turnPhase !== 'flip') return { error: '不是翻牌阶段' };
        
        const card = this.foodCards[position];
        if (!card || card.revealed) return { error: '无效位置' };
        
        card.revealed = true;
        const cardInfo = CARD_DATA.foods.find(f => f.id === card.id);
        
        let result = {
            position,
            cardId: card.id,
            playerId,
            playerPoints: player.points,
            eliminated: false
        };
        
        const isDouble = player.role?.id === 'archer' || this.doubleNext[playerId];
        this.doubleNext[playerId] = false;
        
        // 处理特殊效果
        switch (cardInfo.special) {
            case 'death':
                if (player.hasShield || player.role?.id === 'graveyard') {
                    player.hasShield = false;
                    card.revealed = false;
                    result.log = `${player.name} 翻到毒药但被免疫!`;
                } else {
                    player.alive = false;
                    result.eliminated = true;
                    result.log = `${player.name} 翻到毒药，被淘汰!`;
                }
                break;
                
            case 'steal_3':
                const targets = Array.from(this.players.values()).filter(p => p.alive && p.id !== playerId);
                if (targets.length > 0) {
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    const stolen = Math.min(3, target.points);
                    target.points -= stolen;
                    player.points += stolen;
                    result.log = `${player.name} 从${target.name}夺取${stolen}积分!`;
                }
                break;
                
            case 'draw_item':
                if (this.itemDeck.length > 0) {
                    player.items.push(this.itemDeck.pop());
                    result.log = `${player.name} 获得1张道具牌!`;
                }
                break;
                
            case 'double_points':
                this.doubleNext[playerId] = true;
                result.log = `${player.name} 获得翻倍效果!`;
                break;
                
            case 'extra_flip':
                result.extraFlip = true;
                player.points += cardInfo.points * (isDouble ? 2 : 1);
                result.playerPoints = player.points;
                result.log = `${player.name} 翻到${cardInfo.name}，获得${cardInfo.points * (isDouble ? 2 : 1)}积分，还有额外翻牌!`;
                break;
                
            default:
                if (cardInfo.points > 0) {
                    player.points += cardInfo.points * (isDouble ? 2 : 1);
                    result.playerPoints = player.points;
                    result.log = `${player.name} 翻到${cardInfo.name}，获得${cardInfo.points * (isDouble ? 2 : 1)}积分!`;
                }
        }
        
        // 检查游戏结束
        if (this.checkGameEnd()) {
            result.gameEnd = true;
        } else if (!result.extraFlip) {
            this.nextTurn();
        }
        
        return result;
    }
    
    nextTurn() {
        this.currentTurnIndex = this.getNextAliveIndex();
        const alive = this.getAlivePlayers();
        
        if (alive.length <= 1) {
            return { gameEnd: true };
        }
        
        // 检查是否所有非毒药牌都翻完了
        const allRevealed = this.foodCards.every(c => c.id === 'poison' || c.revealed);
        if (allRevealed) {
            return { gameEnd: true, endType: 'points' };
        }
        
        // 检查是否回到第一个玩家（新一轮）
        if (this.currentTurnIndex === 0) {
            this.round++;
        }
        
        this.turnPhase = 'flip';
        this.turnStartTime = Date.now();
        
        return { nextPlayer: this.getCurrentPlayer(), round: this.round };
    }
    
    checkGameEnd() {
        const alive = this.getAlivePlayers();
        if (alive.length <= 1) return true;
        return this.foodCards.every(c => c.id === 'poison' || c.revealed);
    }
    
    getWinner() {
        const alive = this.getAlivePlayers();
        if (alive.length === 1) return alive[0];
        // 积分胜利
        return Array.from(this.players.values()).sort((a, b) => b.points - a.points)[0];
    }
    
    useItem(playerId, itemIndex) {
        const player = this.players.get(playerId);
        if (!player || !player.alive) return { error: '无效玩家' };
        if (this.getCurrentPlayer().id !== playerId) return { error: '不是你的回合' };
        
        const item = player.items[itemIndex];
        if (!item) return { error: '没有这张道具' };
        
        const itemInfo = CARD_DATA.items.find(i => i.id === item.id);
        player.items.splice(itemIndex, 1);
        this.discardDeck.push(item);
        
        let result = { itemId: item.id, itemName: itemInfo.name };
        
        switch (itemInfo.special) {
            case 'shield':
                player.hasShield = true;
                result.log = `${player.name} 使用护身符，获得毒药免疫!`;
                break;
            case 'steal_3':
                const targets = Array.from(this.players.values()).filter(p => p.alive && p.id !== playerId);
                if (targets.length > 0) {
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    const stolen = Math.min(3, target.points);
                    target.points -= stolen;
                    player.points += stolen;
                    result.log = `${player.name} 使用妙手空空，从${target.name}夺取${stolen}积分!`;
                }
                break;
            case 'gold':
                player.points += 7;
                result.log = `${player.name} 使用点石成金，获得7积分!`;
                break;
            case 'cure':
                player.hasShield = true;
                result.log = `${player.name} 使用解毒剂，获得免疫!`;
                break;
            default:
                result.log = `${player.name} 使用了${itemInfo.name}!`;
        }
        
        return result;
    }
    
    useRoleSkill(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.alive) return { error: '无效玩家' };
        if (player.roleUsed) return { error: '技能已使用' };
        
        player.roleUsed = true;
        let result = { roleId: player.role.id };
        
        switch (player.role.id) {
            case 'innocent':
                this.foodCards = shuffle(this.foodCards.map(c => ({ ...c, revealed: false })));
                result.log = `${player.name}（纯白之女）重新洗牌!`;
                break;
            case 'rogue':
                const targets = Array.from(this.players.values()).filter(p => p.alive && p.id !== playerId);
                if (targets.length > 0) {
                    const target = targets[Math.floor(Math.random() * targets.length)];
                    const stolen = Math.min(3, target.points);
                    target.points -= stolen;
                    player.points += stolen;
                    result.log = `${player.name}（老流氓）从${target.name}夺取${stolen}积分!`;
                }
                break;
            case 'skip':
                result.skipTurn = true;
                result.log = `${player.name}（少女）跳过了回合!`;
                break;
            default:
                result.log = `${player.name} 触发了${player.role.name}技能!`;
        }
        
        return result;
    }
    
    buyItem(playerId) {
        const player = this.players.get(playerId);
        if (!player || !player.alive) return { error: '无效玩家' };
        if (this.getCurrentPlayer().id !== playerId) return { error: '不是你的回合' };
        
        const cost = player.role?.id === 'girl' ? 4 : CONFIG.BUY_COST;
        if (player.points < cost) return { error: '积分不足' };
        if (this.itemDeck.length === 0) return { error: '道具牌堆空了' };
        
        player.points -= cost;
        player.items.push(this.itemDeck.pop());
        
        return {
            itemId: player.items[player.items.length - 1].id,
            cost,
            points: player.points,
            log: `${player.name} 购买了1张道具牌`
        };
    }
    
    broadcast(message, excludeId = null) {
        for (const [id, player] of this.players) {
            if (id !== excludeId && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(JSON.stringify(message));
            }
        }
    }
    
    broadcastRoomUpdate() {
        const list = this.getPlayerList();
        this.broadcast({ type: 'room_update', players: list });
    }
    
    getPlayerList() {
        return Array.from(this.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.id === this.hostId
        }));
    }
    
    getGameState() {
        const players = Array.from(this.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            points: p.points,
            alive: p.alive,
            role: p.role,
            items: p.items
        }));
        
        return {
            players,
            foodCards: this.foodCards,
            itemDeckCount: this.itemDeck.length,
            currentTurnIndex: this.currentTurnIndex,
            round: this.round,
            turnPhase: this.turnPhase
        };
    }
}

// ========== 游戏服务器 ==========
class GameServer {
    constructor() {
        this.wss = null;
        this.rooms = new Map();
        this.players = new Map();
    }
    
    start(port) {
        this.wss = new WebSocket.Server({ port });
        console.log(`🎮 服务器启动在端口 ${port}`);
        
        this.wss.on('connection', (ws) => {
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    this.handleMessage(ws, msg);
                } catch (e) {
                    console.error('解析错误:', e);
                }
            });
            
            ws.on('close', () => this.handleDisconnect(ws));
            ws.on('error', (e) => console.error('WS错误:', e));
        });
    }
    
    handleMessage(ws, msg) {
        const { type, ...data } = msg;
        
        switch (type) {
            case 'login': this.handleLogin(ws, data); break;
            case 'create_room': this.handleCreateRoom(ws, data); break;
            case 'join_room': this.handleJoinRoom(ws, data); break;
            case 'leave_room': this.handleLeaveRoom(ws); break;
            case 'start_game': this.handleStartGame(ws); break;
            case 'flip_card': this.handleFlipCard(ws, data); break;
            case 'use_item': this.handleUseItem(ws, data); break;
            case 'use_role_skill': this.handleUseRoleSkill(ws); break;
            case 'buy_item': this.handleBuyItem(ws); break;
            case 'skip_phase': this.handleSkipPhase(ws); break;
        }
    }
    
    handleLogin(ws, { nickname }) {
        ws.playerId = uuidv4();
        ws.nickname = nickname;
        this.players.set(ws.playerId, { ws, roomCode: null });
        ws.send(JSON.stringify({ type: 'login', playerId: ws.playerId }));
    }
    
    handleCreateRoom(ws, { maxPlayers }) {
        if (!ws.playerId) return ws.send(JSON.stringify({ type: 'error', message: '请先登录' }));
        
        let code;
        do { code = generateRoomCode(); } while (this.rooms.has(code));
        
        const room = new Room(code, ws.playerId, maxPlayers);
        room.addPlayer(ws, ws.nickname);
        this.rooms.set(code, room);
        this.players.get(ws.playerId).roomCode = code;
        
        ws.send(JSON.stringify({
            type: 'room_created',
            roomCode: code,
            maxPlayers,
            players: room.getPlayerList()
        }));
    }
    
    handleJoinRoom(ws, { roomCode, nickname }) {
        if (!ws.playerId) return ws.send(JSON.stringify({ type: 'error', message: '请先登录' }));
        
        const room = this.rooms.get(roomCode);
        if (!room) return ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        if (room.gameStarted) return ws.send(JSON.stringify({ type: 'error', message: '游戏已开始' }));
        if (room.players.size >= room.maxPlayers) return ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
        
        const player = room.addPlayer(ws, nickname || ws.nickname);
        this.players.get(ws.playerId).roomCode = roomCode;
        
        ws.send(JSON.stringify({
            type: 'room_joined',
            roomCode,
            maxPlayers: room.maxPlayers,
            players: room.getPlayerList()
        }));
        
        room.broadcast({ type: 'player_joined', playerId: player.id, playerName: player.name }, ws.playerId);
        
        // 广播 room_update 给所有玩家（包括新加入的玩家），更新完整玩家列表
        room.broadcast({ type: 'room_update', players: room.getPlayerList() });
        
        // 尝试自动开始游戏（玩家>=2时）
        room.tryAutoStart();
    }
    
    handleLeaveRoom(ws) {
        const info = this.players.get(ws.playerId);
        if (!info?.roomCode) return;
        
        const room = this.rooms.get(info.roomCode);
        if (!room) return;
        
        room.removePlayer(ws.playerId);
        room.broadcast({ type: 'player_left', playerId: ws.playerId });
        
        if (room.players.size === 0) {
            this.rooms.delete(info.roomCode);
        }
        info.roomCode = null;
    }
    
    handleStartGame(ws) {
        const info = this.players.get(ws.playerId);
        if (!info?.roomCode) return;
        
        const room = this.rooms.get(info.roomCode);
        if (!room || !room.isHost(ws.playerId)) return ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始' }));
        
        if (!room.startGame()) {
            return ws.send(JSON.stringify({ type: 'error', message: '玩家不足' }));
        }
        
        // 清除自动开始定时器
        room.clearAutoStartTimer();
        
        for (const [id, player] of room.players) {
            const state = room.getGameState();
            player.ws.send(JSON.stringify({
                type: 'game_start',
                ...state,
                myId: player.id,
                assignedRole: player.role,
                assignedItems: player.items
            }));
        }
    }
    
    handleFlipCard(ws, { position }) {
        const info = this.players.get(ws.playerId);
        if (!info?.roomCode) return;
        
        const room = this.rooms.get(info.roomCode);
        if (!room || !room.gameStarted) return;
        
        const result = room.flipCard(ws.playerId, position);
        
        if (result.error) {
            return ws.send(JSON.stringify({ type: 'error', message: result.error }));
        }
        
        room.broadcast({ type: 'card_flipped', ...result });
        ws.send(JSON.stringify({ type: 'card_flipped', ...result }));
        
        if (result.gameEnd) {
            const winner = room.getWinner();
            room.broadcast({
                type: 'game_end',
                winner: { id: winner.id, name: winner.name },
                players: room.getGameState().players,
                endType: 'survival'
            });
        } else if (result.nextPlayer) {
            room.broadcast({
                type: 'turn_update',
                currentTurnIndex: room.currentTurnIndex,
                round: room.round,
                phase: room.turnPhase
            });
        }
    }
    
    handleUseItem(ws, { itemIndex }) {
        const info = this.players.get(ws.playerId);
        if (!info?.roomCode) return;
        
        const room = this.rooms.get(info.roomCode);
        if (!room) return;
        
        const result = room.useItem(ws.playerId, itemIndex);
        
        if (result.error) {
            return ws.send(JSON.stringify({ type: 'error', message: result.error }));
        }
        
        room.broadcast({ type: 'item_used', playerId: ws.playerId, ...result });
        ws.send(JSON.stringify({ type: 'item_used', ...result }));
    }
    
    handleUseRoleSkill(ws) {
        const info = this.players.get(ws.playerId);
        if (!info?.roomCode) return;
        
        const room = this.rooms.get(info.roomCode);
        if (!room) return;
        
        const result = room.useRoleSkill(ws.playerId);
        
        if (result.error) {
            return ws.send(JSON.stringify({ type: 'error', message: result.error }));
        }
        
        room.broadcast({ type: 'role_skill_used', playerId: ws.playerId, ...result });
        ws.send(JSON.stringify({ type: 'role_skill_used', ...result }));
        
        if (result.skipTurn) {
            room.nextTurn();
            room.broadcast({ type: 'turn_update', currentTurnIndex: room.currentTurnIndex, round: room.round });
        }
    }
    
    handleBuyItem(ws) {
        const info = this.players.get(ws.playerId);
        if (!info?.roomCode) return;
        
        const room = this.rooms.get(info.roomCode);
        if (!room) return;
        
        const result = room.buyItem(ws.playerId);
        
        if (result.error) {
            return ws.send(JSON.stringify({ type: 'error', message: result.error }));
        }
        
        room.broadcast({ type: 'item_bought', playerId: ws.playerId, ...result });
        ws.send(JSON.stringify({ type: 'item_bought', ...result }));
    }
    
    handleSkipPhase(ws) {
        const info = this.players.get(ws.playerId);
        if (!info?.roomCode) return;
        
        const room = this.rooms.get(info.roomCode);
        if (!room || room.getCurrentPlayer().id !== ws.playerId) return;
        
        if (room.turnPhase === 'flip') {
            room.turnPhase = 'buy';
        } else {
            const next = room.nextTurn();
            if (next.gameEnd) {
                const winner = room.getWinner();
                room.broadcast({
                    type: 'game_end',
                    winner: { id: winner.id, name: winner.name },
                    players: room.getGameState().players,
                    endType: next.endType || 'survival'
                });
            } else {
                room.broadcast({ type: 'turn_update', currentTurnIndex: room.currentTurnIndex, round: room.round, phase: room.turnPhase });
            }
        }
    }
    
    handleDisconnect(ws) {
        if (ws.playerId) {
            const info = this.players.get(ws.playerId);
            if (info?.roomCode) {
                this.handleLeaveRoom(ws);
            }
            this.players.delete(ws.playerId);
        }
    }
}

const server = new GameServer();
server.start(PORT);
