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

  if (peer)
