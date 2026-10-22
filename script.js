const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const damageOverlay = document.getElementById('damage-overlay');
const gameContainer = document.getElementById('game-container');

// Elementos da Interface (UI)
const loginScreen = document.getElementById('login-screen');
const mainMenu = document.getElementById('main-menu');
const lobbyScreen = document.getElementById('lobby-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreBoard = document.getElementById('score-board');

// HUD / Placar
const hpBlueFill = document.getElementById('hp-blue-fill');
const hpRedFill = document.getElementById('hp-red-fill');
const specialFill = document.getElementById('special-fill');
const p1Name = document.getElementById('p1-name');
const p1Avatar = document.getElementById('p1-avatar');

// Efeitos de Áudio Sintetizado (Web Audio API)
const actx = new (window.AudioContext || window.webkitAudioContext)();
function playTone(freq, type, dur, vol) {
    if (actx.state === 'suspended') actx.resume();
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = type; 
    osc.frequency.setValueAtTime(freq, actx.currentTime);
    if (type === 'square') osc.frequency.exponentialRampToValueAtTime(20, actx.currentTime + dur);
    gain.gain.setValueAtTime(vol, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + dur);
    osc.connect(gain); 
    gain.connect(actx.destination);
    osc.start(); 
    osc.stop(actx.currentTime + dur);
}
const sfx = {
    shoot: () => playTone(600, 'sawtooth', 0.1, 0.1),
    special: () => playTone(300, 'triangle', 0.4, 0.2),
    hit: () => playTone(140, 'square', 0.2, 0.2)
};

// Estados Globais
let userProfile = { name: '', avatar: '', pwdHash: '' };
let gameMode = 'bot'; 
let botDifficulty = 'medium';
let isHost = true, peer = null, connections = [], myId = 0, gameRunning = false;
let specialEnergy = 0;
let players = [], bullets = [], particles = [], stars = [];

// Planeta do Fundo
let planet = { x: 0, y: 0, rad: 0 };

// Ajustar Tamanho da Tela Responsivo (Full Window)
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    planet.x = canvas.width * 0.8;
    planet.y = canvas.height * 0.2;
    planet.rad = Math.min(canvas.width, canvas.height) * 0.15;
}
window.addEventListener('resize', resize);
resize();

// Gerar Estrelas de Fundo
for (let i = 0; i < 150; i++) {
    stars.push({ 
        x: Math.random() * canvas.width, 
        y: Math.random() * canvas.height, 
        size: Math.random() * 2, 
        speed: Math.random() * 2 + 1 
    });
}

// Controles de Teclado
const keys = {};
window.addEventListener('keydown', e => { 
    keys[e.code] = true; 
    if (['KeyE', 'ShiftLeft', 'ShiftRight'].includes(e.code)) triggerSpecial(); 
});
window.addEventListener('keyup', e => keys[e.code] = false);

// SISTEMA DE PERFIL E LOGIN (Estilo Agar.io / LocalStorage)
document.getElementById('btn-login').addEventListener('click', () => {
    const user = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-password').value.trim();
    const avatar = document.querySelector('input[name="avatar"]:checked').value;
    
    if (!user || !pass) return alert("Preencha o Apelido e a Senha!");
    
    const hash = btoa(pass); // Criptografia simples em B64 local
    userProfile = { name: user, avatar: avatar, pwdHash: hash };
    localStorage.setItem('neonProfile', JSON.stringify(userProfile));
    showMenu();
});

document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('neonProfile');
    mainMenu.classList.add('hidden');
    loginScreen.classList.remove('hidden');
});

// Carregar Perfil Salvo
const saved = localStorage.getItem('neonProfile');
if (saved) { 
    userProfile = JSON.parse(saved); 
    showMenu(); 
}

function showMenu() {
    loginScreen.classList.add('hidden');
    mainMenu.classList.remove('hidden');
    document.getElementById('menu-username').textContent = userProfile.name;
    document.getElementById('menu-avatar').textContent = userProfile.avatar;
    p1Name.textContent = userProfile.name.toUpperCase();
    p1Avatar.textContent = userProfile.avatar;
}

// Botão de Tela Cheia
document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(e => {});
    else if (document.exitFullscreen) document.exitFullscreen();
});

// NAVEGAÇÃO DOS MODOS
document.getElementById('btn-mode-bot').addEventListener('click', () => {
    botDifficulty = document.getElementById('bot-difficulty').value;
    startBotMode();
});
document.getElementById('btn-mode-1v1').addEventListener('click', () => openLobby('1v1'));
document.getElementById('btn-mode-2v2').addEventListener('click', () => openLobby('2v2'));
document.getElementById('btn-back-menu').addEventListener('click', resetToMenu);
document.getElementById('btn-play-again').addEventListener('click', resetToMenu);

// --- MODO VS BOT ---
function startBotMode() {
    gameMode = 'bot'; 
    isHost = true; 
    myId = 0; 
    specialEnergy = 0;
    mainMenu.classList.add('hidden'); 
    scoreBoard.classList.remove('hidden');
    
    players = [
        { id: 0, x: canvas.width / 2 - 20, y: canvas.height - 100, team: 'blue', hp: 20, maxHp: 20, lastShot: 0 },
        { id: 1, x: canvas.width / 2 - 20, y: 100, team: 'red', hp: 20, maxHp: 20, lastShot: 0, isBot: true }
    ];
    bullets = []; 
    particles = []; 
    damageOverlay.className = '';
    updateScoreUI(); 
    gameRunning = true; 
    requestAnimationFrame(gameLoop);
}

// --- LÓGICA DO LOBBY CORRIGIDA (SEM LOOPS AUTOMÁTICOS) ---
function openLobby(mode) {
    gameMode = mode; 
    isHost = true; 
    specialEnergy = 0;
    
    mainMenu.classList.add('hidden'); 
    lobbyScreen.classList.remove('hidden');
    
    const statusMsg = document.getElementById('peer-status-msg');
    statusMsg.className = 'status-connecting';
    statusMsg.textContent = 'Pronto para conectar!';
    
    document.getElementById('room-code').textContent = '...';
    document.getElementById('btn-start-game').disabled = false;
    document.getElementById('btn-start-game').classList.remove('disabled');
}

// Criar Sala ao clicar no botão
document.getElementById('btn-copy-code').addEventListener('click', () => {
    if (peer && peer.id) {
        navigator.clipboard.writeText(peer.id);
        alert('Código copiado!');
    } else {
        // Se ainda não criou o peer, cria agora
        if (peer) peer.destroy();
        peer = new Peer();
        document.getElementById('peer-status-msg').textContent = 'Gerando Código...';
        peer.on('open', id => {
            document.getElementById('peer-status-msg').className = 'status-ready';
            document.getElementById('peer-status-msg').textContent = 'Sala Aberta!';
            document.getElementById('room-code').textContent = id;
            navigator.clipboard.writeText(id);
            alert('Código gerado e copiado!');
        });
        peer.on('connection', conn => {
            connections.push(conn);
            alert('Jogador Conectado!');
        });
    }
});

// Entrar em Sala Existente
document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = document.getElementById('join-code-input').value.trim();
    if (!code) return alert('Cole um código válido!');
    
    isHost = false;
    if (peer) peer.destroy();
    
    peer = new Peer();
    peer.on('open', () => {
        const conn = peer.connect(code);
        connections = [conn];
        conn.on('open', () => {
            alert('Conectado à sala! Aguarde o Host iniciar.');
            document.getElementById('peer-status-msg').textContent = 'Conectado!';
        });
    });
});

document.getElementById('btn-start-game').addEventListener('click', () => {
    initGameSession();
});

function initGameSession() {
    lobbyScreen.classList.add('hidden'); 
    scoreBoard.classList.remove('hidden');
    
    players = [
        { id: 0, x: canvas.width / 2 - 20, y: canvas.height - 100, team: 'blue', hp: 20, maxHp: 20, lastShot: 0 },
        { id: 1, x: canvas.width / 2 - 20, y: 100, team: 'red', hp: 20, maxHp: 20, lastShot: 0 }
    ];
    bullets = []; 
    particles = []; 
    damageOverlay.className = ''; 
    updateScoreUI(); 
    gameRunning = true; 
    requestAnimationFrame(gameLoop);
}

function resetToMenu() {
    gameRunning = false;
    if (peer) { 
        peer.destroy(); 
        peer = null; 
    }
    connections = [];
    scoreBoard.classList.add('hidden');
    lobbyScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    mainMenu.classList.remove('hidden');
    damageOverlay.className = '';
}

// --- ATAQUE ESPECIAL [E / SHIFT] ---
function triggerSpecial() {
    if (!gameRunning || specialEnergy < 100) return;
    specialEnergy = 0; 
    sfx.special();
    const p = players.find(x => x.id === myId);
    if (p && p.hp > 0) fireSpecial(p);
}

function fireSpecial(p) {
    const dir = p.team === 'blue' ? -1 : 1;
    [-0.4, -0.2, 0, 0.2, 0.4].forEach(a => {
        bullets.push({ 
            x: p.x + 18, 
            y: p.y + (dir < 0 ? 0 : 35), 
            vx: Math.sin(a) * 10, 
            vy: dir * Math.cos(a) * 12, 
            team: p.team, 
            special: true 
        });
    });
    explosion(p.x + 20, p.y + 15, '#ff0', 30);
}

// --- DANO, EFEITOS DE TELA E SCREEN SHAKE ---
function takeDamage(p, dmg) {
    p.hp -= dmg; 
    if (p.hp < 0) p.hp = 0;
    explosion(p.x + 20, p.y + 15, p.team === 'blue' ? '#0ff' : '#f05', 20);
    sfx.hit();
    updateScoreUI();
    
    // Animação de Dano no Jogador Local
    if (p.id === myId) {
        gameContainer.classList.remove('shake-screen');
        void gameContainer.offsetWidth; // Reflow para reiniciar animação CSS
        gameContainer.classList.add('shake-screen');
        
        damageOverlay.classList.add('damage-flash');
        setTimeout(() => damageOverlay.classList.remove('damage-flash'), 100);
        
        if (p.hp <= p.maxHp * 0.3 && p.hp > 0) damageOverlay.classList.add('danger-low-hp');
        else damageOverlay.classList.remove('danger-low-hp');
    }
    
    if (p.hp <= 0) {
        damageOverlay.className = '';
        setTimeout(() => {
            gameRunning = false;
            gameOverScreen.classList.remove('hidden');
            scoreBoard.classList.add('hidden');
            document.getElementById('winner-title').textContent = p.team === 'blue' ? 'DERROTA' : 'VITÓRIA!';
        }, 1000);
    }
}

// --- INTELIGÊNCIA ARTIFICIAL DOS BOTS (3 DIFICULDADES) ---
function updateBotLogic(bot, target) {
    const speed = botDifficulty === 'hard' ? 7 : (botDifficulty === 'medium' ? 5 : 3);
    const diffX = target.x - bot.x;
    
    let moveLeft = diffX < -20, moveRight = diffX > 20;
    
    // Modo Insano (Hard) - Desvia de Projéteis ativamente
    if (botDifficulty === 'hard') {
        const incoming = bullets.find(b => b.team !== bot.team && b.y > bot.y && b.y < bot.y + 300 && Math.abs(b.x - bot.x) < 40);
        if (incoming) {
            if (incoming.x > bot.x + 18) { moveLeft = true; moveRight = false; }
            else { moveRight = true; moveLeft = false; }
        }
    }

    if (moveLeft && bot.x > 0) bot.x -= speed;
    if (moveRight && bot.x < canvas.width - 40) bot.x += speed;

    // Frequência de Disparo
    const fireRate = botDifficulty === 'hard' ? 30 : (botDifficulty === 'medium' ? 60 : 120);
    const accuracy = botDifficulty === 'hard' ? 100 : 50;
    if (Math.abs(diffX) < accuracy && Math.random() < (1 / fireRate) && Date.now() - bot.lastShot > 300) {
        bullets.push({ x: bot.x + 18, y: bot.y + 35, vx: 0, vy: 10, team: bot.team });
        bot.lastShot = Date.now(); 
        sfx.shoot();
    }
    
    // Bot Usa Especial no modo Insano
    if (botDifficulty === 'hard' && Math.random() < 0.005) fireSpecial(bot);
}

// --- ATUALIZAÇÃO DO JOGO (UPDATE) ---
function updateGame() {
    if (!gameRunning) return;
    
    if (specialEnergy < 100) {
        specialEnergy += 0.2;
        specialFill.style.width = specialEnergy + '%';
    }

    const p = players[0];
    const speed = 8;
    if ((keys['ArrowLeft'] || keys['KeyA']) && p.x > 0) p.x -= speed;
    if ((keys['ArrowRight'] || keys['KeyD']) && p.x < canvas.width - 40) p.x += speed;
    if ((keys['Space'] || keys['ArrowUp'] || keys['KeyW']) && Date.now() - p.lastShot > 150) {
        bullets.push({ x: p.x + 18, y: p.y, vx: 0, vy: -12, team: p.team });
        p.lastShot = Date.now(); 
        sfx.shoot();
    }

    if (gameMode === 'bot' && players[1].hp > 0) updateBotLogic(players[1], p);

    bullets.forEach((b, i) => {
        b.x += b.vx; 
        b.y += b.vy;
        players.forEach(pl => {
            if (pl.hp > 0 && b.team !== pl.team && b.x > pl.x - 10 && b.x < pl.x + 50 && b.y > pl.y - 10 && b.y < pl.y + 50) {
                takeDamage(pl, b.special ? 5 : 2);
                bullets.splice(i, 1);
            }
        });
        if (b.y < 0 || b.y > canvas.height || b.x < 0 || b.x > canvas.width) bullets.splice(i, 1);
    });

    particles.forEach((pt, i) => { 
        pt.x += pt.vx; 
        pt.y += pt.vy; 
        pt.l--; 
        if (pt.l <= 0) particles.splice(i, 1); 
    });
}

function updateScoreUI() {
    hpBlueFill.style.width = (players[0].hp / players[0].maxHp * 100) + '%';
    hpRedFill.style.width = (players[1].hp / players[1].maxHp * 100) + '%';
}

function explosion(x, y, c, cnt) {
    for (let i = 0; i < cnt; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, l: 30, c });
}

// --- RENDERIZAÇÃO PIXEL ART NO CANVAS ---
const P_BLUE = [
    [0, 0, 1, 1, 0, 0],
    [0, 1, 2, 2, 1, 0],
    [1, 1, 3, 3, 1, 1],
    [1, 2, 2, 2, 2, 1],
    [0, 1, 1, 1, 1, 0],
    [0, 4, 0, 0, 4, 0]
];

function drawShip(x, y, isRed, isMe) {
    ctx.save(); 
    ctx.translate(x, y);
    const pal = isRed ? { 1: '#500', 2: '#f05', 3: '#ff0', 4: '#f60' } : { 1: '#035', 2: '#0ff', 3: '#fff', 4: '#f07' };
    const sz = 6.5;
    P_BLUE.forEach((r, ri) => r.forEach((v, ci) => {
        if (v) { 
            ctx.fillStyle = pal[v]; 
            ctx.fillRect(ci * sz, (isRed ? 5 - ri : ri) * sz, sz, sz); 
        }
    }));
    if (isMe) { 
        ctx.strokeStyle = '#ff0'; 
        ctx.strokeRect(-2, -2, 42, 42); 
    }
    ctx.restore();
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Desenho do Planeta do Fundo
    planet.y += 0.1; 
    if (planet.y > canvas.height + planet.rad) planet.y = -planet.rad;
    const g = ctx.createRadialGradient(planet.x - 20, planet.y - 20, 10, planet.x, planet.y, planet.rad);
    g.addColorStop(0, '#0ff'); 
    g.addColorStop(1, '#102');
    ctx.fillStyle = g; 
    ctx.beginPath(); 
    ctx.arc(planet.x, planet.y, planet.rad, 0, Math.PI * 2); 
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 0, 127, 0.3)'; 
    ctx.lineWidth = 15;
    ctx.beginPath(); 
    ctx.ellipse(planet.x, planet.y, planet.rad * 1.5, planet.rad * 0.3, -0.3, 0, Math.PI * 2); 
    ctx.stroke();

    // Estrelas de Fundo
    stars.forEach(s => {
        s.y += s.speed; 
        if (s.y > canvas.height) s.y = 0;
        ctx.fillStyle = '#fff'; 
        ctx.fillRect(s.x, s.y, s.size, s.size);
    });

    if (!gameRunning) return;
    
    // Renderizar Naves, Tiros e Partículas
    players.forEach(p => { if (p.hp > 0) drawShip(p.x, p.y, p.team === 'red', p.id === myId); });
    bullets.forEach(b => {
        ctx.fillStyle = b.special ? '#ff0' : (b.team === 'blue' ? '#0ff' : '#f05');
        if (b.special) { 
            ctx.beginPath(); 
            ctx.arc(b.x, b.y, 5, 0, 6); 
            ctx.fill(); 
        } else {
            ctx.fillRect(b.x - 2, b.y, 4, 12);
        }
    });
    particles.forEach(p => { ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, 3, 3); });
}

function gameLoop() { 
    updateGame(); 
    render(); 
    if (gameRunning) requestAnimationFrame(gameLoop); 
}
