'use strict';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const damageOverlay = document.getElementById('damage-overlay');
const gameContainer = document.getElementById('game-container');

// Interface
const loginScreen = document.getElementById('login-screen');
const mainMenu = document.getElementById('main-menu');
const lobbyScreen = document.getElementById('multiplayer-lobby');
const lobbyChoices = document.getElementById('lobby-choices');
const hostPanel = document.getElementById('host-panel');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreBoard = document.getElementById('score-board');
const peerStatusMsg = document.getElementById('peer-status-msg');
const roomCodeDisplay = document.getElementById('room-code-display');
const hostWaitingLabel = document.getElementById('host-waiting-label');
const startGameButton = document.getElementById('btn-start-game');

const hpBlueFill = document.getElementById('hp-blue-fill');
const hpRedFill = document.getElementById('hp-red-fill');
const specialFill = document.getElementById('special-fill');
const p1Name = document.getElementById('p1-name');
const p1Avatar = document.getElementById('p1-avatar');
const enemyName = document.getElementById('enemy-name');

// Áudio
let audioContext = null;

function playTone(freq, type, duration, volume) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume();

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);

    if (type === 'square') {
      oscillator.frequency.exponentialRampToValueAtTime(
        20,
        audioContext.currentTime + duration
      );
    }

    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + duration
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  } catch (error) {
    console.warn('Não foi possível reproduzir o efeito sonoro.', error);
  }
}

const sfx = {
  shoot: () => playTone(600, 'sawtooth', 0.1, 0.055),
  special: () => playTone(300, 'triangle', 0.4, 0.12),
  hit: () => playTone(140, 'square', 0.2, 0.1)
};

// Estado do jogo
let userProfile = { name: '', avatar: '👨‍🚀' };
let gameMode = 'bot';
let botDifficulty = 'medium';

let isHost = true;
let peer = null;
let connections = [];
let myId = 0;

let gameRunning = false;
let endingGame = false;

let players = [];
let bullets = [];
let particles = [];
let stars = [];

let remoteInput = {
  left: false,
  right: false,
  shoot: false,
  special: false
};

let pendingSpecial = false;
let lastInputSentAt = 0;
let lastSnapshotSentAt = 0;
let remotePlayerName = 'OPONENTE';

// Fundo
const planet = { x: 0, y: 0, rad: 0 };

function resize() {
  canvas.width = Math.max(1, window.innerWidth);
  canvas.height = Math.max(1, window.innerHeight);

  planet.x = canvas.width * 0.8;
  planet.y = canvas.height * 0.2;
  planet.rad = Math.min(canvas.width, canvas.height) * 0.15;

  if (players.length) {
    players.forEach(player => {
      player.x = Math.max(0, Math.min(player.x, canvas.width - 42));
      player.y = player.team === 'blue' ? canvas.height - 100 : 70;
    });
  }
}

window.addEventListener('resize', resize);
resize();

for (let i = 0; i < 150; i++) {
  stars.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: Math.random() * 2 + 0.3,
    speed: Math.random() * 2 + 0.5
  });
}

// Controles
const keys = Object.create(null);

const gameKeys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Space',
  'KeyA',
  'KeyD',
  'KeyW'
]);

window.addEventListener('keydown', event => {
  if (gameKeys.has(event.code)) event.preventDefault();

  keys[event.code] = true;

  if (
    !event.repeat &&
    ['KeyE', 'ShiftLeft', 'ShiftRight'].includes(event.code)
  ) {
    triggerSpecial();
  }
});

window.addEventListener('keyup', event => {
  keys[event.code] = false;
});

window.addEventListener('blur', () => {
  Object.keys(keys).forEach(key => {
    keys[key] = false;
  });
});

// Lobby
function setLobbyStatus(message, status = 'connecting') {
  peerStatusMsg.textContent = message;

  if (status === 'ready') {
    peerStatusMsg.className = 'status-connecting status-ready';
  } else if (status === 'error') {
    peerStatusMsg.className = 'status-connecting status-error';
  } else {
    peerStatusMsg.className = 'status-connecting';
  }
}

function showMenu() {
  loginScreen.classList.add('hidden');
  mainMenu.classList.remove('hidden');
  lobbyScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  scoreBoard.classList.add('hidden');

  document.getElementById('menu-username').textContent =
    userProfile.name || 'Piloto';

  document.getElementById('menu-avatar').textContent =
    userProfile.avatar || '👨‍🚀';

  p1Name.textContent = (userProfile.name || 'VOCÊ').toUpperCase();
  p1Avatar.textContent = userProfile.avatar || '👨‍🚀';
}

// Login local
document.getElementById('btn-login').addEventListener('click', () => {
  const name = document
    .getElementById('login-username')
    .value.trim()
    .slice(0, 15);

  const password = document.getElementById('login-password').value;

  const avatarInput = document.querySelector(
    'input[name="avatar"]:checked'
  );

  if (!name || !password) {
    alert('Preencha o apelido e a senha local.');
    return;
  }

  // A senha não é armazenada nem usada para autenticar uma conta.
  userProfile = {
    name,
    avatar: avatarInput ? avatarInput.value : '👨‍🚀'
  };

  try {
    localStorage.setItem('neonProfile', JSON.stringify(userProfile));
  } catch (error) {
    console.warn('O perfil não pôde ser salvo neste navegador.', error);
  }

  document.getElementById('login-password').value = '';
  showMenu();
});

document.getElementById('btn-logout').addEventListener('click', () => {
  resetToMenu();

  try {
    localStorage.removeItem('neonProfile');
  } catch (_) {}

  userProfile = { name: '', avatar: '👨‍🚀' };

  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';

  mainMenu.classList.add('hidden');
  loginScreen.classList.remove('hidden');
});

// Carregar perfil salvo
try {
  const savedProfile = localStorage.getItem('neonProfile');

  if (savedProfile) {
    const parsed = JSON.parse(savedProfile);

    if (
      parsed &&
      typeof parsed.name === 'string' &&
      parsed.name.trim()
    ) {
      userProfile = {
        name: parsed.name.slice(0, 15),
        avatar: typeof parsed.avatar === 'string'
          ? parsed.avatar
          : '👨‍🚀'
      };

      showMenu();
    }
  }
} catch (error) {
  console.warn('O perfil salvo estava inválido e foi ignorado.', error);
}

// Tela cheia
document.getElementById('btn-fullscreen').addEventListener(
  'click',
  async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.warn(
        'Tela cheia não está disponível neste navegador.',
        error
      );
    }
  }
);

// Navegação
document.getElementById('btn-mode-bot').addEventListener('click', () => {
  botDifficulty = document.getElementById('bot-difficulty').value;
  startBotMode();
});

document.getElementById('btn-mode-1v1').addEventListener('click', () => {
  openLobby('1v1');
});

document.getElementById('btn-mode-2v2').addEventListener('click', () => {
  alert(
    'O modo 2v2 ainda não está implementado. ' +
    'O modo VS BOT e o 1v1 online estão disponíveis.'
  );
});

document.getElementById('btn-back-menu').addEventListener(
  'click',
  resetToMenu
);

document.getElementById('btn-play-again').addEventListener(
  'click',
  resetToMenu
);

document.getElementById('btn-create-room').addEventListener(
  'click',
  createRoom
);

document.getElementById('btn-join-room').addEventListener(
  'click',
  joinRoom
);

document.getElementById('btn-copy-code').addEventListener(
  'click',
  copyRoomCode
);

startGameButton.addEventListener('click', () => {
  if (
    !isHost ||
    connections.length === 0 ||
    !connections[0].open
  ) {
    return;
  }

  startOnlineGame();
  sendToConnections({ type: 'start', mode: '1v1' });
});

document.getElementById('join-code').addEventListener(
  'keydown',
  event => {
    if (event.key === 'Enter') joinRoom();
  }
);

function openLobby(mode) {
  if (mode !== '1v1') return;

  resetNetwork();

  gameMode = mode;
  isHost = false;
  myId = 1;

  mainMenu.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  scoreBoard.classList.add('hidden');

  lobbyScreen.classList.remove('hidden');
  lobbyChoices.classList.remove('hidden');
  hostPanel.classList.add('hidden');

  startGameButton.disabled = true;
  roomCodeDisplay.textContent = 'Aguardando...';

  document.getElementById('room-code-caption').textContent =
    'Código da sala:';

  hostWaitingLabel.textContent = 'Aguardando oponente...';

  setLobbyStatus(
    'Crie uma sala para ser o anfitrião ou entre com o código de outra pessoa.'
  );
}

function resetNetwork() {
  connections.forEach(connection => {
    try {
      connection.close();
    } catch (_) {}
  });

  connections = [];

  if (peer) {
    try {
      peer.destroy();
    } catch (_) {}

    peer = null;
  }
}

function createPeer() {
  if (typeof Peer === 'undefined') {
    setLobbyStatus(
      'A biblioteca PeerJS não carregou. Verifique a internet e recarregue a página.',
      'error'
    );
    return null;
  }

  try {
    return new Peer(undefined, { debug: 1 });
  } catch (error) {
    console.error(error);

    setLobbyStatus(
      'Não foi possível iniciar a conexão multiplayer.',
      'error'
    );

    return null;
  }
}

// Criar sala online
function createRoom() {
  resetNetwork();

  gameMode = '1v1';
  isHost = true;
  myId = 0;

  remoteInput = {
    left: false,
    right: false,
    shoot: false,
    special: false
  };

  lobbyChoices.classList.add('hidden');
  hostPanel.classList.remove('hidden');

  startGameButton.disabled = true;
  startGameButton.classList.remove('hidden');

  roomCodeDisplay.textContent = 'Gerando código...';

  document.getElementById('room-code-caption').textContent =
    'Código da sua sala:';

  hostWaitingLabel.textContent = 'Aguardando o outro jogador entrar...';

  setLobbyStatus('Conectando ao serviço de sinalização...');

  peer = createPeer();
  if (!peer) return;

  peer.on('open', id => {
    roomCodeDisplay.textContent = id;
    setLobbyStatus(
      'Sala criada. Envie o código para seu oponente.',
      'ready'
    );
  });

  peer.on('connection', connection => {
    if (connections.length >= 1) {
      connection.close();
      return;
    }

    connections = [connection];
    attachConnectionHandlers(connection, true);
  });

  peer.on('error', handlePeerError);

  peer.on('disconnected', () => {
    setLobbyStatus(
      'Conexão com o servidor multiplayer foi interrompida.',
      'error'
    );
  });
}

// Entrar em sala existente
function joinRoom() {
  const code = document.getElementById('join-code').value.trim();

  if (!code) {
    alert('Digite o código da sala.');
    return;
  }

  resetNetwork();

  gameMode = '1v1';
  isHost = false;
  myId = 1;

  lobbyChoices.classList.add('hidden');
  hostPanel.classList.remove('hidden');

  startGameButton.disabled = true;
  startGameButton.classList.add('hidden');

  roomCodeDisplay.textContent = code;

  document.getElementById('room-code-caption').textContent =
    'Sala selecionada:';

  hostWaitingLabel.textContent = 'Conectando ao anfitrião...';

  setLobbyStatus('Criando conexão...');

  peer = createPeer();
  if (!peer) return;

  peer.on('open', () => {
    const connection = peer.connect(code, { reliable: true });

    connections = [connection];

    attachConnectionHandlers(connection, false);
  });

  peer.on('error', handlePeerError);

  peer.on('disconnected', () => {
    setLobbyStatus(
      'Conexão com o servidor multiplayer foi interrompida.',
      'error'
    );
  });
}

function attachConnectionHandlers(connection, hostSide) {
  connection.on('open', () => {
    if (hostSide) {
      setLobbyStatus(
        'Oponente conectado. A partida pode começar.',
        'ready'
      );

      hostWaitingLabel.textContent =
        'Oponente conectado! Clique para iniciar.';

      startGameButton.disabled = false;

      sendSafe(connection, {
        type: 'hello',
        name: userProfile.name || 'Piloto',
        avatar: userProfile.avatar || '👨‍🚀'
      });
    } else {
      setLobbyStatus(
        'Conectado ao anfitrião. Aguardando o início da partida.',
        'ready'
      );

      hostWaitingLabel.textContent =
        'Conectado. O anfitrião iniciará a partida.';

      sendSafe(connection, {
        type: 'hello',
        name: userProfile.name || 'Piloto',
        avatar: userProfile.avatar || '👨‍🚀'
      });
    }
  });

  connection.on('data', message => {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'hello' && hostSide) {
      remotePlayerName =
        typeof message.name === 'string'
          ? message.name.slice(0, 15)
          : 'OPONENTE';

      if (players[1]) {
        players[1].name = remotePlayerName;
        updateScoreUI();
      }
    } else if (message.type === 'input' && hostSide) {
      const input = message.input || {};

      remoteInput = {
        left: Boolean(input.left),
        right: Boolean(input.right),
        shoot: Boolean(input.shoot),
        special: Boolean(input.special)
      };
    } else if (message.type === 'start' && !hostSide) {
      gameMode = '1v1';
      myId = 1;
      startOnlineGame();
    } else if (message.type === 'state' && !hostSide) {
      applyRemoteState(message.state);
    } else if (message.type === 'gameover' && !hostSide) {
      showGameOver(message.winnerTeam);
    }
  });

  connection.on('close', () => {
    if (gameRunning && gameMode !== 'bot') {
      showConnectionLost();
    } else {
      setLobbyStatus('O outro jogador desconectou.', 'error');
    }

    startGameButton.disabled = true;
    hostWaitingLabel.textContent = 'Oponente desconectado.';
  });

  connection.on('error', error => {
    console.error('Erro na conexão P2P:', error);

    setLobbyStatus(
      'A conexão com o outro jogador falhou. Confira o código e tente novamente.',
      'error'
    );
  });
}

function handlePeerError(error) {
  console.error('Erro PeerJS:', error);

  const messages = {
    'peer-unavailable': 'Sala não encontrada. Confira o código e tente novamente.',
    'network': 'Falha de rede ao conectar. Verifique sua internet.',
    'server-error': 'O serviço de conexão está indisponível no momento.',
    'browser-incompatible': 'Este navegador não oferece suporte à conexão necessária.',
    'unavailable-id': 'Esse código já está sendo usado. Crie outra sala.'
  };

  setLobbyStatus(
    messages[error.type] ||
    'Erro no multiplayer: ' + (error.type || 'desconhecido') + '.',
    'error'
  );
}

async function copyRoomCode() {
  const code = roomCodeDisplay.textContent.trim();

  if (
    !code ||
    code === 'Aguardando...' ||
    code === 'Gerando código...'
  ) {
    return;
  }

  try {
    await navigator.clipboard.writeText(code);
    setLobbyStatus('Código copiado. Envie para seu oponente.', 'ready');
  } catch (_) {
    window.prompt('Copie o código da sala:', code);
  }
}

function sendSafe(connection, payload) {
  if (!connection || !connection.open) return;

  try {
    connection.send(payload);
  } catch (error) {
    console.warn('Não foi possível enviar dados ao oponente.', error);
  }
}

function sendToConnections(payload) {
  connections.forEach(connection => sendSafe(connection, payload));
}

// Jogadores
function makePlayers(mode) {
  return [
    {
      id: 0,
      x: canvas.width / 2 - 20,
      y: canvas.height - 100,
      team: 'blue',
      hp: 20,
      maxHp: 20,
      lastShot: 0,
      specialEnergy: 0,
      name: userProfile.name || 'VOCÊ'
    },
    {
      id: 1,
      x: canvas.width / 2 - 20,
      y: 70,
      team: 'red',
      hp: 20,
      maxHp: 20,
      lastShot: 0,
      specialEnergy: 0,
      name: mode === 'bot' ? 'BOT' : remotePlayerName,
      isBot: mode === 'bot'
    }
  ];
}

function prepareMatch(mode) {
  endingGame = false;
  gameMode = mode;

  players = makePlayers(mode);
  bullets = [];
  particles = [];

  remoteInput = {
    left: false,
    right: false,
    shoot: false,
    special: false
  };

  pendingSpecial = false;
  lastInputSentAt = 0;
  lastSnapshotSentAt = 0;

  damageOverlay.className = '';

  gameOverScreen.classList.add('hidden');
  mainMenu.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  scoreBoard.classList.remove('hidden');

  updateScoreUI();
  gameRunning = true;
}

function startBotMode() {
  resetNetwork();

  isHost = true;
  myId = 0;
  remotePlayerName = 'BOT';

  prepareMatch('bot');
}

function startOnlineGame() {
  myId = isHost ? 0 : 1;

  prepareMatch('1v1');

  if (isHost && connections.length) {
    sendState();
  }
}

function resetToMenu() {
  gameRunning = false;
  endingGame = false;
  pendingSpecial = false;

  Object.keys(keys).forEach(key => {
    keys[key] = false;
  });

  resetNetwork();

  players = [];
  bullets = [];
  particles = [];

  scoreBoard.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  loginScreen.classList.add('hidden');
  mainMenu.classList.remove('hidden');

  damageOverlay.className = '';
}

// Ataque especial
function triggerSpecial() {
  if (!gameRunning) return;

  // O cliente pede ao anfitrião para usar o especial.
  if (gameMode !== 'bot' && !isHost) {
    pendingSpecial = true;
    return;
  }

  const player = players.find(item => item.id === myId);

  if (player) {
    trySpecial(player);
  }
}

function trySpecial(player) {
  if (!player || player.hp <= 0 || player.specialEnergy < 100) {
    return false;
  }

  player.specialEnergy = 0;
  sfx.special();
  fireSpecial(player);
  updateScoreUI();

  return true;
}

function fireSpecial(player) {
  const direction = player.team === 'blue' ? -1 : 1;

  [-0.4, -0.2, 0, 0.2, 0.4].forEach(angle => {
    bullets.push({
      x: player.x + 18,
      y: player.y + (direction < 0 ? 0 : 35),
      vx: Math.sin(angle) * 10,
      vy: direction * Math.cos(angle) * 12,
      team: player.team,
      special: true
    });
  });

  explosion(player.x + 20, player.y + 15, '#ff0', 24);
}

// Dano
function takeDamage(player, damage) {
  if (!player || player.hp <= 0) return;

  player.hp = Math.max(0, player.hp - damage);

  explosion(
    player.x + 20,
    player.y + 15,
    player.team === 'blue' ? '#0ff' : '#f05',
    12
  );

  sfx.hit();
  updateScoreUI();

  if (player.id === myId) {
    gameContainer.classList.remove('shake-screen');
    void gameContainer.offsetWidth;
    gameContainer.classList.add('shake-screen');

    damageOverlay.classList.add('damage-flash');

    window.setTimeout(() => {
      damageOverlay.classList.remove('damage-flash');
    }, 100);

    if (player.hp <= player.maxHp * 0.3 && player.hp > 0) {
      damageOverlay.classList.add('danger-low-hp');
    } else {
      damageOverlay.classList.remove('danger-low-hp');
    }
  }

  if (player.hp <= 0 && !endingGame) {
    endingGame = true;

    window.setTimeout(() => {
      if (!gameRunning) return;

      const winnerTeam = player.team === 'blue' ? 'red' : 'blue';

      if (gameMode !== 'bot' && isHost) {
        sendToConnections({ type: 'gameover', winnerTeam });
      }

      showGameOver(winnerTeam);
    }, 650);
  }
}

function showGameOver(winnerTeam) {
  gameRunning = false;
  endingGame = true;

  damageOverlay.className = '';
  scoreBoard.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  mainMenu.classList.add('hidden');
  gameOverScreen.classList.remove('hidden');

  // O resultado é exibido do ponto de vista do jogador local.
  const localWon =
    (myId === 0 && winnerTeam === 'blue') ||
    (myId === 1 && winnerTeam === 'red');

  document.getElementById('winner-title').textContent =
    localWon ? 'VITÓRIA!' : 'DERROTA';
}

function showConnectionLost() {
  gameRunning = false;
  endingGame = true;

  scoreBoard.classList.add('hidden');
  gameOverScreen.classList.remove('hidden');

  document.getElementById('winner-title').textContent =
    'CONEXÃO PERDIDA';
}

// Controles do jogador
function readLocalInput() {
  return {
    left: Boolean(keys.ArrowLeft || keys.KeyA),
    right: Boolean(keys.ArrowRight || keys.KeyD),
    shoot: Boolean(keys.Space || keys.ArrowUp || keys.KeyW),
    special: false
  };
}

function applyPlayerInput(player, input) {
  if (!player || player.hp <= 0) return;

  const speed = 7.5;

  if (input.left) player.x -= speed;
  if (input.right) player.x += speed;

  player.x = Math.max(0, Math.min(canvas.width - 42, player.x));

  const now = Date.now();

  if (input.shoot && now - player.lastShot > 155) {
    const isBlue = player.team === 'blue';

    bullets.push({
      x: player.x + 18,
      y: player.y + (isBlue ? 0 : 35),
      vx: 0,
      vy: isBlue ? -12 : 12,
      team: player.team,
      special: false
    });

    player.lastShot = now;
    sfx.shoot();
  }
}

// Inteligência artificial
function updateBotLogic(bot, target) {
  if (!bot || !target || bot.hp <= 0) return;

  const speed =
    botDifficulty === 'hard'
      ? 6.5
      : botDifficulty === 'medium'
        ? 4.5
        : 2.7;

  const diffX = target.x - bot.x;

  let moveLeft = diffX < -20;
  let moveRight = diffX > 20;

  if (botDifficulty === 'hard') {
    const incoming = bullets.find(b =>
      b.team !== bot.team &&
      b.y > bot.y &&
      b.y < bot.y + 300 &&
      Math.abs(b.x - (bot.x + 20)) < 45
    );

    if (incoming) {
      if (incoming.x > bot.x + 20) {
        moveLeft = true;
        moveRight = false;
      } else {
        moveRight = true;
        moveLeft = false;
      }
    }
  }

  if (moveLeft) bot.x -= speed;
  if (moveRight) bot.x += speed;

  bot.x = Math.max(0, Math.min(canvas.width - 42, bot.x));

  const fireRate =
    botDifficulty === 'hard'
      ? 26
      : botDifficulty === 'medium'
        ? 48
        : 90;

  const accuracy = botDifficulty === 'hard' ? 115 : 55;

  if (
    Math.abs(diffX) < accuracy &&
    Math.random() < 1 / fireRate &&
    Date.now() - bot.lastShot > 300
  ) {
    bullets.push({
      x: bot.x + 18,
      y: bot.y + 35,
      vx: 0,
      vy: 10,
      team: bot.team,
      special: false
    });

    bot.lastShot = Date.now();
    sfx.shoot();
  }

  if (
    botDifficulty === 'hard' &&
    bot.specialEnergy >= 100 &&
    Math.random() < 0.005
  ) {
    trySpecial(bot);
  }
}

// Atualização principal
function updateGame() {
  if (!gameRunning) return;

  // O cliente envia seus controles para o anfitrião.
  if (gameMode !== 'bot' && !isHost) {
    const now = performance.now();

    if (now - lastInputSentAt >= 33) {
      sendToConnections({
        type: 'input',
        input: {
          left: Boolean(keys.ArrowLeft || keys.KeyA),
          right: Boolean(keys.ArrowRight || keys.KeyD),
          shoot: Boolean(keys.Space || keys.ArrowUp || keys.KeyW),
          special: pendingSpecial
        }
      });

      pendingSpecial = false;
      lastInputSentAt = now;
    }

    return;
  }

  // Recarrega a energia especial.
  players.forEach(player => {
    if (player.hp > 0 && player.specialEnergy < 100) {
      player.specialEnergy = Math.min(
        100,
        player.specialEnergy + 0.18
      );
    }
  });

  if (gameMode === 'bot') {
    applyPlayerInput(players[0], readLocalInput());
    updateBotLogic(players[1], players[0]);
  } else {
    applyPlayerInput(players[0], readLocalInput());
    applyPlayerInput(players[1], remoteInput);

    if (remoteInput.special) {
      trySpecial(players[1]);
      remoteInput.special = false;
    }
  }

  // Atualiza os projéteis de trás para frente.
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];

    bullet.x += bullet.vx;
    bullet.y += bullet.vy;

    if (
      bullet.y < -20 ||
      bullet.y > canvas.height + 20 ||
      bullet.x < -20 ||
      bullet.x > canvas.width + 20
    ) {
      bullets.splice(i, 1);
      continue;
    }

    let hit = false;

    for (const player of players) {
      if (
        player.hp > 0 &&
        bullet.team !== player.team &&
        bullet.x > player.x - 10 &&
        bullet.x < player.x + 48 &&
        bullet.y > player.y - 10 &&
        bullet.y < player.y + 45
      ) {
        takeDamage(player, bullet.special ? 5 : 2);
        hit = true;
        break;
      }
    }

    if (hit) bullets.splice(i, 1);
  }

  // Partículas
  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];

    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.l--;

    if (particle.l <= 0) {
      particles.splice(i, 1);
    }
  }

  updateScoreUI();

  // O anfitrião envia o estado atualizado da partida.
  if (
    gameMode !== 'bot' &&
    isHost &&
    performance.now() - lastSnapshotSentAt >= 33
  ) {
    sendState();
    lastSnapshotSentAt = performance.now();
  }
}

function updateScoreUI() {
  if (players.length < 2) return;

  hpBlueFill.style.width =
    `${Math.max(0, players[0].hp / players[0].maxHp * 100)}%`;

  hpRedFill.style.width =
    `${Math.max(0, players[1].hp / players[1].maxHp * 100)}%`;

  const energy = players[myId]
    ? players[myId].specialEnergy
    : 0;

  specialFill.style.width =
    `${Math.max(0, Math.min(100, energy || 0))}%`;

  p1Name.textContent =
    (players[0].name || userProfile.name || 'VOCÊ').toUpperCase();

  p1Avatar.textContent = userProfile.avatar || '👨‍🚀';

  enemyName.textContent =
    (players[1].name ||
      (gameMode === 'bot' ? 'BOT' : 'OPONENTE')).toUpperCase();
}

// Sincronização online
function sendState() {
  if (!isHost || gameMode === 'bot') return;

  const state = {
    players,
    bullets,
    particles,
    winner: null
  };

  sendToConnections({ type: 'state', state });
}

function applyRemoteState(state) {
  if (
    !state ||
    !Array.isArray(state.players) ||
    state.players.length < 2
  ) {
    return;
  }

  const oldHp = players[myId]
    ? players[myId].hp
    : null;

  players = state.players;
  bullets = Array.isArray(state.bullets) ? state.bullets : [];
  particles = Array.isArray(state.particles) ? state.particles : [];

  if (
    oldHp !== null &&
    players[myId] &&
    players[myId].hp < oldHp
  ) {
    damageOverlay.classList.add('damage-flash');

    window.setTimeout(() => {
      damageOverlay.classList.remove('damage-flash');
    }, 100);

    gameContainer.classList.remove('shake-screen');
    void gameContainer.offsetWidth;
    gameContainer.classList.add('shake-screen');
  }

  updateScoreUI();
}

// Explosões
function explosion(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 10,
      vy: (Math.random() - 0.5) * 10,
      l: 30,
      c: color
    });
  }
}

// Nave em pixel art
const PIXEL_SHIP = [
  [0, 0, 1, 1, 0, 0],
  [0, 1, 2, 2, 1, 0],
  [1, 1, 3, 3, 1, 1],
  [1, 2, 2, 2, 2, 1],
  [0, 1, 1, 1, 1, 0],
  [0, 4, 0, 0, 4, 0]
];

function drawShip(x, y, isRed, isMe) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));

  const palette = isRed
    ? { 1: '#500', 2: '#f05', 3: '#ff0', 4: '#f60' }
    : { 1: '#035', 2: '#0ff', 3: '#fff', 4: '#f07' };

  const size = 6.5;

  PIXEL_SHIP.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (!value) return;

      ctx.fillStyle = palette[value];

      ctx.fillRect(
        columnIndex * size,
        (isRed ? 5 - rowIndex : rowIndex) * size,
        size,
        size
      );
    });
  });

  if (isMe) {
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 1;
    ctx.strokeRect(-2, -2, 42, 42);
  }

  ctx.restore();
}

// Renderização
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  planet.y += 0.1;

  if (planet.y > canvas.height + planet.rad) {
    planet.y = -planet.rad;
  }

  const gradient = ctx.createRadialGradient(
    planet.x - 20,
    planet.y - 20,
    10,
    planet.x,
    planet.y,
    Math.max(1, planet.rad)
  );

  gradient.addColorStop(0, '#0ff');
  gradient.addColorStop(1, '#102');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(planet.x, planet.y, planet.rad, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,0,127,.3)';
  ctx.lineWidth = 15;
  ctx.beginPath();

  ctx.ellipse(
    planet.x,
    planet.y,
    planet.rad * 1.5,
    planet.rad * 0.3,
    -0.3,
    0,
    Math.PI * 2
  );

  ctx.stroke();

  stars.forEach(star => {
    star.y += star.speed;

    if (star.y > canvas.height) {
      star.y = 0;
      star.x = Math.random() * canvas.width;
    }

    ctx.fillStyle = '#fff';
    ctx.fillRect(star.x, star.y, star.size, star.size);
  });

  if (!gameRunning) return;

  players.forEach(player => {
    if (player.hp > 0) {
      drawShip(
        player.x,
        player.y,
        player.team === 'red',
        player.id === myId
      );
    }
  });

  bullets.forEach(bullet => {
    ctx.fillStyle = bullet.special
      ? '#ff0'
      : bullet.team === 'blue'
        ? '#0ff'
        : '#f05';

    if (bullet.special) {
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(bullet.x - 2, bullet.y, 4, 12);
    }
  });

  particles.forEach(particle => {
    ctx.fillStyle = particle.c;
    ctx.fillRect(particle.x, particle.y, 3, 3);
  });
}

// Um único loop de animação para evitar loops duplicados.
function gameLoop() {
  updateGame();
  render();
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
