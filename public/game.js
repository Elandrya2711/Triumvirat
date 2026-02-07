/**
 * Triumvirat - Client-side game rendering and interaction
 */

const socket = io();

// State
let gameId = null;
let myPlayerIndex = -1;
let numPlayers = 2;
let boardLayout = [];
let adjacency = [];
let colors = [];
let playerNames = [];
let gameState = null;
let selectedPos = null;
let validTargets = [];
let animating = false;
let chainActive = null; // position of marble in active chain jump

// Canvas setup
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const DPR = window.devicePixelRatio || 1;

// Board rendering constants
const BOARD_PADDING = 60;
const MARBLE_SIZES = { 1: 14, 2: 19, 3: 24 }; // small, medium, large radius

// Position coordinates cache
let posCoords = [];

function resizeCanvas() {
  const container = canvas.parentElement;
  const w = Math.min(container.clientWidth, 600);
  const h = w * 0.9;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = w * DPR;
  canvas.height = h * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  computePositions(w, h);
  render();
}

function computePositions(w, h) {
  posCoords = [];
  const pad = BOARD_PADDING;
  const numRows = 6;
  
  const topX = w / 2, topY = pad;
  const blX = pad, blY = h - pad;
  const brX = w - pad, brY = h - pad;
  
  for (let row = 0; row < numRows; row++) {
    for (let col = 0; col <= row; col++) {
      const t = row / (numRows - 1);
      const leftX = topX + (blX - topX) * t;
      const leftY = topY + (blY - topY) * t;
      const rightX = topX + (brX - topX) * t;
      const rightY = topY + (brY - topY) * t;
      
      const s = row === 0 ? 0 : col / row;
      const x = leftX + (rightX - leftX) * s;
      const y = leftY + (rightY - leftY) * s;
      
      posCoords.push({ x, y });
    }
  }
}

function render() {
  if (!posCoords.length) return;
  const w = canvas.width / DPR;
  const h = canvas.height / DPR;
  
  ctx.clearRect(0, 0, w, h);
  
  // Draw board background
  drawBoard(w, h);
  
  // Draw connections
  drawConnections();
  
  // Draw valid move highlights
  drawHighlights();
  
  // Draw marbles
  drawMarbles();
}

function drawBoard(w, h) {
  // Subtle triangle background
  if (posCoords.length < 21) return;
  ctx.beginPath();
  ctx.moveTo(posCoords[0].x, posCoords[0].y - 30);
  ctx.lineTo(posCoords[15].x - 30, posCoords[15].y + 20);
  ctx.lineTo(posCoords[20].x + 30, posCoords[20].y + 20);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15, 52, 96, 0.3)';
  ctx.fill();
}

function drawConnections() {
  ctx.strokeStyle = 'rgba(100, 120, 160, 0.3)';
  ctx.lineWidth = 2;
  
  if (!adjacency.length) return;
  
  const drawn = new Set();
  for (let i = 0; i < adjacency.length; i++) {
    for (const j of adjacency[i]) {
      const key = Math.min(i, j) + '-' + Math.max(i, j);
      if (drawn.has(key)) continue;
      drawn.add(key);
      
      ctx.beginPath();
      ctx.moveTo(posCoords[i].x, posCoords[i].y);
      ctx.lineTo(posCoords[j].x, posCoords[j].y);
      ctx.stroke();
    }
  }
}

function drawHighlights() {
  // Selected position
  if (selectedPos !== null && posCoords[selectedPos]) {
    const p = posCoords[selectedPos];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 30, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(233, 69, 96, 0.25)';
    ctx.fill();
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  // Valid targets
  for (const t of validTargets) {
    const p = posCoords[t];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(46, 204, 113, 0.3)';
    ctx.fill();
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawMarbles() {
  if (!gameState) return;
  
  for (let i = 0; i < gameState.board.length; i++) {
    const cell = gameState.board[i];
    const p = posCoords[i];
    if (!p) continue;
    
    if (!cell) {
      // Empty slot
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(100, 120, 160, 0.4)';
      ctx.fill();
      continue;
    }
    
    const radius = MARBLE_SIZES[cell.size] || 16;
    const color = colors[cell.player] || '#888';
    
    // Shadow
    ctx.beginPath();
    ctx.arc(p.x + 2, p.y + 2, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
    
    // Marble body
    const grad = ctx.createRadialGradient(p.x - radius * 0.3, p.y - radius * 0.3, radius * 0.1, p.x, p.y, radius);
    grad.addColorStop(0, lightenColor(color, 40));
    grad.addColorStop(0.7, color);
    grad.addColorStop(1, darkenColor(color, 30));
    
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Shine
    ctx.beginPath();
    ctx.arc(p.x - radius * 0.25, p.y - radius * 0.25, radius * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();
    
    // Selection ring for own marbles when it's our turn
    if (gameState.currentPlayer === myPlayerIndex && cell.player === myPlayerIndex && selectedPos === i) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}

function lightenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + percent);
  const g = Math.min(255, ((num >> 8) & 0xff) + percent);
  const b = Math.min(255, (num & 0xff) + percent);
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - percent);
  const g = Math.max(0, ((num >> 8) & 0xff) - percent);
  const b = Math.max(0, (num & 0xff) - percent);
  return `rgb(${r},${g},${b})`;
}

// Input handling
function getClickedPosition(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
  const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
  const scaleX = (canvas.width / DPR) / rect.width;
  const scaleY = (canvas.height / DPR) / rect.height;
  const cx = x * scaleX;
  const cy = y * scaleY;
  
  let closest = -1;
  let minDist = 35;
  for (let i = 0; i < posCoords.length; i++) {
    const dx = posCoords[i].x - cx;
    const dy = posCoords[i].y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < minDist) {
      minDist = dist;
      closest = i;
    }
  }
  return closest;
}

canvas.addEventListener('click', handleClick);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleClick(e);
});

function handleClick(e) {
  if (!gameState || gameState.gameOver || animating) return;
  if (gameState.currentPlayer !== myPlayerIndex) {
    showToast('Nicht dein Zug!');
    return;
  }
  
  const pos = getClickedPosition(e);
  if (pos < 0) return;
  
  // During chain jump, only allow clicking valid continuation targets
  if (chainActive !== null) {
    if (validTargets.includes(pos)) {
      socket.emit('make-move', { from: chainActive, to: pos });
      return;
    }
    showToast('Springe weiter oder beende den Zug!');
    return;
  }
  
  // If clicking a valid target, make the move
  if (selectedPos !== null && validTargets.includes(pos)) {
    socket.emit('make-move', { from: selectedPos, to: pos });
    selectedPos = null;
    validTargets = [];
    render();
    return;
  }
  
  // If clicking own marble, select it
  const cell = gameState.board[pos];
  if (cell && cell.player === myPlayerIndex) {
    selectedPos = pos;
    validTargets = [];
    socket.emit('get-moves', { from: pos });
    render();
    return;
  }
  
  // Deselect
  selectedPos = null;
  validTargets = [];
  render();
}

// UI helpers
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2500);
}

function updateTurnDisplay() {
  if (!gameState) return;
  const turnEl = document.getElementById('turn-display');
  const color = colors[gameState.currentPlayer];
  const name = playerNames[gameState.currentPlayer];
  const isMyTurn = gameState.currentPlayer === myPlayerIndex;
  turnEl.textContent = isMyTurn ? '🎯 Du bist dran!' : `⏳ ${name} ist dran`;
  turnEl.style.background = color;
  turnEl.style.color = '#fff';
  
  // Marble counts
  const countsEl = document.getElementById('marble-counts');
  countsEl.innerHTML = gameState.marbleCount.map((c, i) => 
    `<div class="marble-count">
      <span class="marble-dot" style="background:${colors[i]}"></span>
      <span>${c}</span>
    </div>`
  ).join('');
}

function updateStatus(msg) {
  document.getElementById('game-status').textContent = msg;
}

function updateEndTurnButton() {
  const btn = document.getElementById('end-turn-btn');
  if (!btn) return;
  if (chainActive !== null && gameState && gameState.currentPlayer === myPlayerIndex) {
    btn.classList.remove('hidden');
  } else {
    btn.classList.add('hidden');
  }
}

// Lobby UI
const countBtns = document.querySelectorAll('.count-btn');
countBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    countBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    numPlayers = parseInt(btn.dataset.count);
  });
});

document.getElementById('create-btn').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim() || 'Spieler 1';
  socket.emit('create-game', { playerName: name, numPlayers });
});

document.getElementById('ai-btn').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim() || 'Spieler 1';
  socket.emit('create-game', { playerName: name, numPlayers: 2, vsAI: true });
});

document.getElementById('join-btn').addEventListener('click', () => {
  const name = document.getElementById('join-name').value.trim() || 'Spieler';
  const code = document.getElementById('game-code').value.trim();
  if (!code) { showToast('Bitte Spiel-Code eingeben'); return; }
  socket.emit('join-game', { gameId: code, playerName: name });
});

document.getElementById('copy-btn').addEventListener('click', () => {
  const code = document.getElementById('invite-code').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(() => showToast('Code kopiert!')).catch(() => fallbackCopy(code));
  } else {
    fallbackCopy(code);
  }
});

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  showToast('Code kopiert!');
}

document.getElementById('end-turn-btn').addEventListener('click', () => {
  if (chainActive !== null) {
    socket.emit('end-turn');
  }
});

document.getElementById('new-game-btn').addEventListener('click', () => {
  document.getElementById('game-over-overlay').classList.add('hidden');
  showScreen('lobby');
  gameState = null;
  selectedPos = null;
  validTargets = [];
});

// Socket events
socket.on('game-created', (data) => {
  gameId = data.gameId;
  myPlayerIndex = data.playerIndex;
  numPlayers = data.numPlayers;
  boardLayout = data.boardLayout;
  adjacency = data.adjacency;
  colors = data.colors;
  playerNames = data.playerNames;
  
  document.getElementById('invite-code').textContent = gameId;
  document.getElementById('game-id-display').textContent = `#${gameId}`;
  if (!data.vsAI) {
    showScreen('waiting');
  }
  // AI games auto-start via game-start event
});

socket.on('game-joined', (data) => {
  gameId = data.gameId;
  myPlayerIndex = data.playerIndex;
  numPlayers = data.numPlayers;
  boardLayout = data.boardLayout;
  adjacency = data.adjacency;
  colors = data.colors;
  playerNames = data.playerNames;
  
  document.getElementById('invite-code').textContent = gameId;
  document.getElementById('game-id-display').textContent = `#${gameId}`;
  showScreen('waiting');
});

socket.on('player-joined', (data) => {
  const listEl = document.getElementById('player-list');
  listEl.innerHTML = data.players.map(p => 
    `<div class="player-item" style="background:${colors[p.index]}">${p.name}</div>`
  ).join('');
  const needed = data.needed - data.players.length;
  document.getElementById('needed-count').textContent = needed;
  document.getElementById('waiting-info').style.display = needed > 0 ? 'block' : 'none';
});

socket.on('game-start', (data) => {
  gameState = data.state;
  showScreen('game');
  resizeCanvas();
  updateTurnDisplay();
  updateStatus(gameState.currentPlayer === myPlayerIndex ? 'Wähle eine Kugel aus!' : 'Warte auf den Gegner...');
});

socket.on('valid-moves', (data) => {
  if (data.from === selectedPos) {
    validTargets = data.moves;
    render();
  }
});

socket.on('move-made', (data) => {
  gameState = data.state;
  
  if (data.chainActive !== null && data.chainActive !== undefined) {
    // Chain jump active
    chainActive = data.chainActive;
    selectedPos = data.chainActive;
    validTargets = data.continuationMoves || [];
    render();
    updateTurnDisplay();
    updateEndTurnButton();
    if (gameState.currentPlayer === myPlayerIndex) {
      updateStatus(`🔥 Kettensprung! Springe weiter oder beende den Zug.`);
    } else {
      updateStatus(`Gegner kann weiterspringen...`);
    }
  } else {
    chainActive = null;
    selectedPos = null;
    validTargets = [];
    render();
    updateTurnDisplay();
    updateEndTurnButton();
    
    if (data.captures.length > 0) {
      updateStatus(`${data.captures.length} Kugel(n) geschlagen!`);
    } else {
      updateStatus(gameState.currentPlayer === myPlayerIndex ? 'Du bist dran!' : 'Warte auf den Gegner...');
    }
  }
});

socket.on('turn-ended', (data) => {
  gameState = data.state;
  chainActive = null;
  selectedPos = null;
  validTargets = [];
  render();
  updateTurnDisplay();
  updateEndTurnButton();
  updateStatus(gameState.currentPlayer === myPlayerIndex ? 'Du bist dran!' : 'Warte auf den Gegner...');
});

socket.on('game-over', (data) => {
  gameState = data.state;
  render();
  const overlay = document.getElementById('game-over-overlay');
  const winnerText = document.getElementById('winner-text');
  if (data.winner === myPlayerIndex) {
    winnerText.textContent = '🏆 Du hast gewonnen!';
  } else {
    winnerText.textContent = `${data.winnerName} hat gewonnen!`;
  }
  overlay.classList.remove('hidden');
});

socket.on('not-your-turn', () => showToast('Nicht dein Zug!'));
socket.on('invalid-move', (data) => showToast(data.error || 'Ungültiger Zug'));
socket.on('error-msg', (data) => showToast(data.message));
socket.on('player-disconnected', (data) => {
  showToast(`${playerNames[data.playerIndex]} hat das Spiel verlassen`);
});

// Resize handling
window.addEventListener('resize', resizeCanvas);

// Check URL for game code
const urlParams = new URLSearchParams(window.location.search);
const joinCode = urlParams.get('join');
if (joinCode) {
  document.getElementById('game-code').value = joinCode;
}
