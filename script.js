// Web Audio API para Efeitos Sonoros Retro
class SoundFX {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    shoot() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(550, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(120, this.ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.08);
    }
    explode() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(160, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(25, this.ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.25);
    }
}

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const sound = new SoundFX();

// Elementos de UI
const mainMenu = document.getElementById('main-menu');
const lobbyScreen = document.getElementById('lobby-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreBoard = document.getElementById('score-board');
const scoreBlueEl = document.getElementById('score-blue');
const scoreRedEl = document.getElementById('score-red');
const gameModeTag = document.getElementById('game-mode-tag');
const winnerTitle = document.getElementById('winner-title');
const winnerDetails = document.getElementById('winner-details');

const roomCodeEl = document.getElementById('room-code');
const joinCodeInput = document.getElementById('join-code-input');
const playerCountEl = document.getElementById('player-count');
const maxPlayersEl = document.getElementById('max-players');
const slotsContainer = document.getElementById('slots-container');
const btnStartGame = document.getElementById('btn-start-game');

// Estados Globais
let gameMode = 'bot'; // 'bot', '1v1', '2v2'
let isHost = true;
let peer = null;
let connections = [];
let myPlayerId = 0;
let gameRunning = false;

// Estado do Jogo (Host mantêm a verdade do jogo)
let players = [];
let bullets = [];
let particles = [];
let stars = [];

// Teclas Pressionadas
const keys = {};
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

// Fundo Estrelado
for (let i = 0; i < 90; i++) {
    stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2 + 1,
        speed: Math.random() * 1.5 + 0.5
    });
}

// BOTOES MENU
document.getElementById('btn-mode-bot').addEventListener('click', () => startLocalBotMode());
document.getElementById('btn-mode-1v1').addEventListener('click', () => openLobby('1v1'));
document.getElementById('btn-mode-2v2').addEventListener('click', () => openLobby('2v2'));
document.getElementById('btn-back-menu').addEventListener('click', resetToMenu);
document.getElementById('btn-play-again').addEventListener('click', resetToMenu);
document.getElementById('btn-copy-code').addEventListener('click', copyRoomCode);
document.getElementById('btn-join-room').addEventListener('click', joinExistingRoom);
btnStartGame.addEventListener('click', () => {
    if (isHost && gameMode !== 'bot') {
        broadcastMessage({ type: 'START_GAME' });
        initGameSession();
    }
});

// Checar parametro de URL para Auto-Join
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        joinCodeInput.value = roomParam;
        openLobby('1v1');
    }
});

function resetToMenu() {
    gameRunning = false;
    if (peer) {
        peer.destroy();
        peer = null;
    }
    connections = [];
    mainMenu.classList.remove('hidden');
    lobbyScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    scoreBoard.classList.add('hidden');
}

// --- MODO 1: VS BOT (LOCAL) ---
function startLocalBotMode() {
    gameMode = 'bot';
    isHost = true;
    myPlayerId = 0;
    
    mainMenu.classList.add('hidden');
    scoreBoard.classList.remove('hidden');
    gameModeTag.textContent = "1v1 VS BOT (TREINO)";

    players = [
        { id: 0, x: canvas.width / 2 - 20, y: canvas.height - 60, team: 'blue', hp: 3, lastShot: 0, name: 'Jogador 1' },
        { id: 1, x: canvas.width / 2 - 20, y: 30, team: 'red', hp: 3, lastShot: 0, isBot: true, name: 'Bot' }
    ];

    bullets = [];
    particles = [];
    updateScoreUI();
    gameRunning = true;
    requestAnimationFrame(gameLoop);
}

// --- MODOS MULTIPLAYER (LOBBY & WEBRTC) ---
function openLobby(mode) {
    gameMode = mode;
    isHost = true;
    mainMenu.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');

    const maxP = mode === '1v1' ? 2 : 4;
    maxPlayersEl.textContent = maxP;
    playerCountEl.textContent = '1';
    
    document.getElementById('host-controls').style.display = 'block';
    document.getElementById('join-controls').style.display = 'block';
    
    updateSlotsUI();

    // Inicializar PeerJS (Servidor de Sinalização Gratuito do PeerJS)
    const randomRoomId = 'space-' + Math.random().toString(36).substring(2, 8);
    peer = new Peer(randomRoomId);

    peer.on('open', (id) => {
        roomCodeEl.textContent = id;
    });

    peer.on('connection', (conn) => {
        if (!isHost) return;
        const maxP = gameMode === '1v1' ? 2 : 4;
        if (connections.length >= maxP - 1) {
            conn.send({ type: 'ERROR', msg: 'Sala Cheia!' });
            setTimeout(() => conn.close(), 500);
            return;
        }

        connections.push(conn);
        setupConnectionEvents(conn);
        updateHostLobbyState();
    });

    peer.on('error', (err) => {
        alert('Erro de conexão PeerJS: ' + err.type);
    });
}

function joinExistingRoom() {
    const code = joinCodeInput.value.trim();
    if (!code) {
        alert('Por favor insira um código de sala válido!');
        return;
    }

    isHost = false;
    peer = new Peer();

    peer.on('open', () => {
        const conn = peer.connect(code);
        connections = [conn];

        conn.on('open', () => {
            document.getElementById('host-controls').style.display = 'none';
            document.getElementById('lobby-title').textContent = 'Conectado no Lobby!';
        });

        setupConnectionEvents(conn);
    });

    peer.on('error', (err) => {
        alert('Não foi possível conectar à sala: ' + err);
    });
}

function setupConnectionEvents(conn) {
    conn.on('data', (data) => {
        if (isHost) {
            if (data.type === 'INPUT') {
                const player = players.find(p => p.id === data.playerId);
                if (player) {
                    player.inputs = data.inputs;
                }
            }
        } else {
            // Cliente recebe comandos do Host
            if (data.type === 'LOBBY_STATE') {
                gameMode = data.gameMode;
                myPlayerId = data.yourId;
                playerCountEl.textContent = data.playerCount;
                maxPlayersEl.textContent = data.maxPlayers;
                renderClientSlots(data.slots);

                if (data.playerCount === data.maxPlayers) {
                    btnStartGame.textContent = "Aguardando Host Iniciar...";
                }
            } else if (data.type === 'START_GAME') {
                initGameSession();
            } else if (data.type === 'GAME_SYNC') {
                players = data.players;
                bullets = data.bullets;
                particles = data.particles;
                updateScoreUI();
            } else if (data.type === 'GAME_OVER') {
                showGameOver(data.winnerTeam);
            }
        }
    });

    conn.on('close', () => {
        if (isHost) {
            connections = connections.filter(c => c !== conn);
            updateHostLobbyState();
        } else {
            alert('A conexão com o Host foi perdida!');
            resetToMenu();
        }
    });
}

function updateHostLobbyState() {
    const maxP = gameMode === '1v1' ? 2 : 4;
    const currentTotal = connections.length + 1;
    playerCountEl.textContent = currentTotal;

    // Montar slots
    const slots = [];
    slots.push({ name: 'Você (Host - Criador)', team: 'blue' });

    connections.forEach((c, index) => {
        const pNum = index + 2;
        const team = (gameMode === '2v2' && pNum > 2) ? 'red' : (gameMode === '1v1' ? 'red' : 'blue');
        slots.push({ name: `Jogador ${pNum}`, team: team });
    });

    // Notificar todos os clientes conectados
    connections.forEach((conn, index) => {
        conn.send({
            type: 'LOBBY_STATE',
            gameMode: gameMode,
            yourId: index + 1,
            playerCount: currentTotal,
            maxPlayers: maxP,
            slots: slots
        });
    });

    renderClientSlots(slots);

    if (currentTotal === maxP) {
        btnStartGame.disabled = false;
        btnStartGame.classList.remove('disabled');
        btnStartGame.textContent = '🚀 INICIAR PARTIDA';
    } else {
        btnStartGame.disabled = true;
        btnStartGame.classList.add('disabled');
        btnStartGame.textContent = `Aguardando Jogadores (${currentTotal}/${maxP})...`;
    }
}

function renderClientSlots(slots) {
    slotsContainer.innerHTML = '';
    slots.forEach((s, idx) => {
        const div = document.createElement('div');
        div.className = `slot ${s.team}`;
        div.textContent = `${idx + 1}. ${s.name} (Time ${s.team === 'blue' ? 'Azul' : 'Vermelho'})`;
        slotsContainer.appendChild(div);
    });
}

function copyRoomCode() {
    const code = roomCodeEl.textContent;
    const shareUrl = window.location.origin + window.location.pathname + '?room=' + code;
    navigator.clipboard.writeText(shareUrl);
    alert('Link da sala copiado! Envie este link para os outros jogadores.');
}

function broadcastMessage(msg) {
    connections.forEach(conn => conn.send(msg));
}

// --- SESSÃO DE JOGO ---
function initGameSession() {
    lobbyScreen.classList.add('hidden');
    scoreBoard.classList.remove('hidden');
    gameModeTag.textContent = gameMode === '1v1' ? 'BATALHA 1v1' : 'BATALHA 2v2';

    if (isHost) {
        players = [];
        if (gameMode === '1v1') {
            players.push({ id: 0, x: canvas.width / 2 - 20, y: canvas.height - 60, team: 'blue', hp: 3, lastShot: 0, inputs: {} });
            players.push({ id: 1, x: canvas.width / 2 - 20, y: 30, team: 'red', hp: 3, lastShot: 0, inputs: {} });
        } else if (gameMode === '2v2') {
            // 2v2: Time Azul na parte inferior, Time Vermelho na parte superior
            players.push({ id: 0, x: canvas.width / 3 - 20, y: canvas.height - 60, team: 'blue', hp: 3, lastShot: 0, inputs: {} });
            players.push({ id: 1, x: (2 * canvas.width) / 3 - 20, y: canvas.height - 60, team: 'blue', hp: 3, lastShot: 0, inputs: {} });
            players.push({ id: 2, x: canvas.width / 3 - 20, y: 30, team: 'red', hp: 3, lastShot: 0, inputs: {} });
            players.push({ id: 3, x: (2 * canvas.width) / 3 - 20, y: 30, team: 'red', hp: 3, lastShot: 0, inputs: {} });
        }
        bullets = [];
        particles = [];
        updateScoreUI();
    }

    gameRunning = true;
    requestAnimationFrame(gameLoop);
}

// --- LÓGICA DE UPDATE E PHYSICS ---
function updateGame() {
    // Atualizar estrelas de fundo
    stars.forEach(s => {
        s.y += s.speed;
        if (s.y > canvas.height) s.y = 0;
    });

    if (!gameRunning) return;

    if (isHost) {
        // Coletar inputs locais do Host (Player ID 0)
        players[0].inputs = {
            left: keys['ArrowLeft'] || keys['KeyA'],
            right: keys['ArrowRight'] || keys['KeyD'],
            shoot: keys['Space']
        };

        // Se for modo VS BOT, simular inteligência artificial do Bot (Player ID 1)
        if (gameMode === 'bot' && players[1]) {
            const bot = players[1];
            const target = players[0];
            const diffX = (target.x) - bot.x;
            
            bot.inputs = {
                left: diffX < -10,
                right: diffX > 10,
                shoot: Math.abs(diffX) < 80
            };
        }

        // Atualizar Posição e Tiros de Cada Jogador
        players.forEach(p => {
            if (p.hp <= 0) return;

            const speed = 6;
            const inps = p.inputs || {};

            if (inps.left && p.x > 0) p.x -= speed;
            if (inps.right && p.x < canvas.width - 40) p.x += speed;

            // Atirar
            if (inps.shoot && Date.now() - p.lastShot > 220) {
                const dirY = p.team === 'blue' ? -1 : 1;
                bullets.push({
                    x: p.x + 18,
                    y: p.team === 'blue' ? p.y : p.y + 30,
                    vy: dirY * 9,
                    team: p.team,
                    ownerId: p.id
                });
                sound.shoot();
                p.lastShot = Date.now();
            }
        });

        // Movimentar Balas & Colisões
        bullets.forEach((b, bi) => {
            b.y += b.vy;

            // Colisão com Jogadores do time oposto
            players.forEach(p => {
                if (p.hp > 0 && p.team !== b.team) {
                    if (
                        b.x >= p.x && b.x <= p.x + 40 &&
                        b.y >= p.y && b.y <= p.y + 30
                    ) {
                        p.hp--;
                        createExplosion(p.x + 20, p.y + 15, p.team === 'blue' ? '#00f0ff' : '#ff0055');
                        sound.explode();
                        bullets.splice(bi, 1);
                        updateScoreUI();
                        checkWinCondition();
                    }
                }
            });

            if (b.y < -20 || b.y > canvas.height + 20) {
                bullets.splice(bi, 1);
            }
        });

        // Partículas
        particles.forEach((pt, pti) => {
            pt.x += pt.vx;
            pt.y += pt.vy;
            pt.life--;
            if (pt.life <= 0) particles.splice(pti, 1);
        });

        // Se for Multiplayer, sincronizar estado com os Clientes
        if (gameMode !== 'bot') {
            broadcastMessage({
                type: 'GAME_SYNC',
                players: players,
                bullets: bullets,
                particles: particles
            });
        }
    } else {
        // Enviar inputs do Cliente para o Host
        const clientInputs = {
            left: keys['ArrowLeft'] || keys['KeyA'],
            right: keys['ArrowRight'] || keys['KeyD'],
            shoot: keys['Space']
        };

        if (connections[0]) {
            connections[0].send({
                type: 'INPUT',
                playerId: myPlayerId,
                inputs: clientInputs
            });
        }

        // Atualizar partículas locais do cliente
        particles.forEach((pt, pti) => {
            pt.x += pt.vx;
            pt.y += pt.vy;
            pt.life--;
            if (pt.life <= 0) particles.splice(pti, 1);
        });
    }
}

function checkWinCondition() {
    const blueHpTotal = players.filter(p => p.team === 'blue').reduce((sum, p) => sum + Math.max(0, p.hp), 0);
    const redHpTotal = players.filter(p => p.team === 'red').reduce((sum, p) => sum + Math.max(0, p.hp), 0);

    if (blueHpTotal <= 0) {
        finishGame('VERMELHO');
    } else if (redHpTotal <= 0) {
        finishGame('AZUL');
    }
}

function finishGame(winnerTeam) {
    gameRunning = false;
    showGameOver(winnerTeam);
    if (gameMode !== 'bot') {
        broadcastMessage({ type: 'GAME_OVER', winnerTeam: winnerTeam });
    }
}

function showGameOver(winnerTeam) {
    gameOverScreen.classList.remove('hidden');
    scoreBoard.classList.add('hidden');
    winnerTitle.textContent = `TIME ${winnerTeam} VENCEU!`;
    winnerTitle.style.color = winnerTeam === 'AZUL' ? '#00f0ff' : '#ff0055';
    winnerDetails.textContent = `A batalha orbital chegou ao fim. Vitória do Time ${winnerTeam}!`;
}

function updateScoreUI() {
    const blueHp = players.filter(p => p.team === 'blue').reduce((sum, p) => sum + Math.max(0, p.hp), 0);
    const redHp = players.filter(p => p.team === 'red').reduce((sum, p) => sum + Math.max(0, p.hp), 0);
    scoreBlueEl.textContent = blueHp;
    scoreRedEl.textContent = redHp;
}

function createExplosion(x, y, color) {
    for (let i = 0; i < 18; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 7,
            vy: (Math.random() - 0.5) * 7,
            life: 22,
            color: color
        });
    }
}

// --- RENDERIZAÇÃO ---
function renderGame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Estrelas
    ctx.fillStyle = '#ffffff';
    stars.forEach(s => ctx.fillRect(s.x, s.y, s.size, s.size));

    if (!gameRunning && mainMenu.classList.contains('hidden') && lobbyScreen.classList.contains('hidden') && gameOverScreen.classList.contains('hidden')) return;

    // Jogadores (Naves)
    players.forEach(p => {
        if (p.hp <= 0) return;

        ctx.fillStyle = p.team === 'blue' ? '#00f0ff' : '#ff0055';
        ctx.beginPath();

        if (p.team === 'blue') {
            // Naves azuis viradas para CIMA
            ctx.moveTo(p.x + 20, p.y);
            ctx.lineTo(p.x, p.y + 30);
            ctx.lineTo(p.x + 40, p.y + 30);
        } else {
            // Naves vermelhas viradas para BAIXO
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + 40, p.y);
            ctx.lineTo(p.x + 20, p.y + 30);
        }
        ctx.closePath();
        ctx.fill();

        // Indicador do Seu Jogador
        if (p.id === myPlayerId) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    // Tiros
    bullets.forEach(b => {
        ctx.fillStyle = b.team === 'blue' ? '#00f0ff' : '#ff0055';
        ctx.fillRect(b.x - 3, b.y, 6, 14);
    });

    // Partículas de Explosão
    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
    });
}

function gameLoop() {
    updateGame();
    renderGame();
    if (gameRunning) {
        requestAnimationFrame(gameLoop);
    }
}
