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
let soloMode = false; // true = local game, no server
let soloGame = null;  // local Game instance (solo mode)
let soloAIWorker = null; // Web Worker for AI
let soloAIConfig = null; // { playerIndex, name, difficulty, moveHistory }

// Animation state
let animationData = null;
const ANIM_BASE_DURATION = 300; // ms base
const ANIM_PER_PIXEL = 2; // ms per pixel distance
let animQueue = []; // Queue for incoming moves while animating
let animLock = false; // Issue #6: Lock for animation queue processing

// Move trail: { player, segments: [{from, to}] } — visible until that player moves again
let moveTrails = {}; // keyed by player index

// Issue #4: Event listener tracking for cleanup
let gameEventListeners = [];

// Issue #4: Register socket events for cleanup
function registerSocketEvent(event, handler) {
  socket.on(event, handler);
  gameEventListeners.push({ event, handler });
}

// Issue #4 & #12: Reset game state (listeners are persistent per page session — that's OK)
function cleanupGameEvents() {
  // Note: Socket event listeners are registered once at script load and remain persistent.
  // This is correct behavior — they check gameId internally.
  animQueue = [];
  animLock = false;
  animating = false;
  animationData = null;
  moveTrails = {};
  selectedPos = null;
  validTargets = [];
  chainActive = null;
}

// Canvas setup
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const DPR = window.devicePixelRatio || 1;

// Load wood texture for board
let woodPattern = null;
const woodImg = new Image();
woodImg.onload = () => {
  woodPattern = ctx.createPattern(woodImg, 'repeat');
  render();
};
woodImg.src = 'textures/wood-board.jpg';

// Board rendering constants
let BOARD_PADDING = 60;
let MARBLE_SIZES = { 1: 14, 2: 19, 3: 24 }; // small, medium, large radius

// Position coordinates cache
let posCoords = [];

function resizeCanvas() {
  const container = canvas.parentElement;
  let w = Math.min(container.clientWidth, 600);
  let h = w * 0.9;
  
  // On mobile: also constrain by available height so board + UI fit without scroll
  const gameScreen = document.getElementById('game');
  if (gameScreen && gameScreen.classList.contains('active') && window.innerWidth <= 600) {
    const header = document.querySelector('.game-header');
    const footer = document.querySelector('.end-turn-container');
    const status = document.querySelector('.game-status');
    const usedH = (header?.offsetHeight || 0) + (footer?.offsetHeight || 0) + (status?.offsetHeight || 0) + 20;
    const availH = window.innerHeight - usedH;
    if (h > availH) {
      h = availH;
      w = h / 0.9;
    }
  }
  
  // Scale padding and marble sizes for small screens
  const scale = w / 600;
  BOARD_PADDING = Math.max(30, Math.round(60 * scale));
  MARBLE_SIZES = {
    1: Math.max(9, Math.round(14 * scale)),
    2: Math.max(12, Math.round(19 * scale)),
    3: Math.max(16, Math.round(24 * scale))
  };
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.width = w * DPR;
  canvas.height = h * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  clearMarbleCache();
  computePositions(w, h);
  render();
}

function computePositions(w, h) {
  posCoords = [];
  const pad = BOARD_PADDING;
  const numRows = 7;
  
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
  
  // Draw move trails
  drawMoveTrails();
  
  // Draw valid move highlights
  drawHighlights();
  
  // Draw marbles
  drawMarbles();
  
  // Draw animating marble on top
  drawAnimatingMarble();
}

function drawBoard(w, h) {
  if (posCoords.length < 28) return;
  
  const p0 = posCoords[0], p21 = posCoords[21], p27 = posCoords[27];
  const margin = 35;
  
  // Board shape
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y - margin);
  ctx.lineTo(p21.x - margin, p21.y + margin * 0.7);
  ctx.lineTo(p27.x + margin, p27.y + margin * 0.7);
  ctx.closePath();
  
  // Fill with wood texture or fallback gradient
  if (woodPattern) {
    ctx.fillStyle = woodPattern;
  } else {
    const woodGrad = ctx.createLinearGradient(0, p0.y - margin, 0, p21.y + margin);
    woodGrad.addColorStop(0, '#6d4c30');
    woodGrad.addColorStop(0.5, '#7a5636');
    woodGrad.addColorStop(1, '#5a3d25');
    ctx.fillStyle = woodGrad;
  }
  ctx.fill();
  
  // Subtle varnish overlay for shine
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y - margin);
  ctx.lineTo(p21.x - margin, p21.y + margin * 0.7);
  ctx.lineTo(p27.x + margin, p27.y + margin * 0.7);
  ctx.closePath();
  ctx.clip();
  const varnish = ctx.createLinearGradient(p21.x, p0.y, p27.x, p21.y);
  varnish.addColorStop(0, 'rgba(255,255,255,0.04)');
  varnish.addColorStop(0.3, 'rgba(255,255,255,0.08)');
  varnish.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  varnish.addColorStop(1, 'rgba(0,0,0,0.05)');
  ctx.fillStyle = varnish;
  ctx.fill();
  ctx.restore();
  
  // Board border — dark outer edge
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y - margin);
  ctx.lineTo(p21.x - margin, p21.y + margin * 0.7);
  ctx.lineTo(p27.x + margin, p27.y + margin * 0.7);
  ctx.closePath();
  ctx.strokeStyle = '#1a0e08';
  ctx.lineWidth = 5;
  ctx.stroke();
  
  // Inner highlight edge
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y - margin + 3);
  ctx.lineTo(p21.x - margin + 3, p21.y + margin * 0.7 - 2);
  ctx.lineTo(p27.x + margin - 3, p27.y + margin * 0.7 - 2);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(180,140,100,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawConnections() {
  if (!adjacency.length) return;
  
  const drawn = new Set();
  for (let i = 0; i < adjacency.length; i++) {
    for (const j of adjacency[i]) {
      const key = Math.min(i, j) + '-' + Math.max(i, j);
      if (drawn.has(key)) continue;
      drawn.add(key);
      
      // Carved groove effect
      ctx.beginPath();
      ctx.moveTo(posCoords[i].x, posCoords[i].y);
      ctx.lineTo(posCoords[j].x, posCoords[j].y);
      ctx.strokeStyle = 'rgba(30,18,10,0.4)';
      ctx.lineWidth = 3;
      ctx.stroke();
      
      // Light edge (highlight)
      ctx.beginPath();
      ctx.moveTo(posCoords[i].x + 1, posCoords[i].y + 1);
      ctx.lineTo(posCoords[j].x + 1, posCoords[j].y + 1);
      ctx.strokeStyle = 'rgba(160,120,80,0.2)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function drawMoveTrails() {
  for (const [playerIdx, trail] of Object.entries(moveTrails)) {
    if (!trail.segments.length) continue;
    const color = colors[playerIdx] || '#888';
    
    for (const seg of trail.segments) {
      const from = posCoords[seg.from];
      const to = posCoords[seg.to];
      if (!from || !to) continue;
      
      // Subtle scratched trail on wood
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }
    
    // Small dot at trail start
    const startPos = posCoords[trail.segments[0].from];
    if (startPos) {
      ctx.beginPath();
      ctx.arc(startPos.x, startPos.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.4;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }
}

function drawHighlights() {
  // Selected position — golden glow
  if (selectedPos !== null && posCoords[selectedPos]) {
    const p = posCoords[selectedPos];
    const glow = ctx.createRadialGradient(p.x, p.y, 5, p.x, p.y, 30);
    glow.addColorStop(0, 'rgba(212,160,23,0.4)');
    glow.addColorStop(1, 'rgba(212,160,23,0)');
    ctx.beginPath();
    ctx.arc(p.x, p.y, 30, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.strokeStyle = '#d4a017';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  
  // Valid targets — subtle green glow
  for (const t of validTargets) {
    const p = posCoords[t];
    if (!p) continue;
    const glow = ctx.createRadialGradient(p.x, p.y, 3, p.x, p.y, 22);
    glow.addColorStop(0, 'rgba(39,174,96,0.35)');
    glow.addColorStop(1, 'rgba(39,174,96,0)');
    ctx.beginPath();
    ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.strokeStyle = 'rgba(39,174,96,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// Marble sprite cache: key = "color-radius" → offscreen canvas (pre-rendered marble)
const marbleCache = new Map();

function getMarbleSprite(radius, color) {
  const key = `${color}-${radius}`;
  if (marbleCache.has(key)) return marbleCache.get(key);
  
  const pad = radius + 8; // extra space for shadow + selection ring
  const size = pad * 2;
  const oc = document.createElement('canvas');
  oc.width = size * DPR;
  oc.height = size * DPR;
  const c = oc.getContext('2d');
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const cx = pad, cy = pad;
  
  // 1. Shadow
  const shadowGrad = c.createRadialGradient(cx + 2, cy + 3, radius * 0.3, cx + 2, cy + 3, radius + 4);
  shadowGrad.addColorStop(0, 'rgba(0,0,0,0.6)');
  shadowGrad.addColorStop(0.6, 'rgba(0,0,0,0.2)');
  shadowGrad.addColorStop(1, 'rgba(0,0,0,0)');
  c.beginPath(); c.arc(cx + 2, cy + 3, radius + 4, 0, Math.PI * 2);
  c.fillStyle = shadowGrad; c.fill();
  
  // 2. Body
  const bodyGrad = c.createRadialGradient(cx - radius * 0.25, cy - radius * 0.25, radius * 0.05, cx + radius * 0.1, cy + radius * 0.1, radius);
  bodyGrad.addColorStop(0, lightenColor(color, 70));
  bodyGrad.addColorStop(0.15, lightenColor(color, 40));
  bodyGrad.addColorStop(0.4, color);
  bodyGrad.addColorStop(0.7, darkenColor(color, 15));
  bodyGrad.addColorStop(0.9, darkenColor(color, 35));
  bodyGrad.addColorStop(1, darkenColor(color, 55));
  c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2);
  c.fillStyle = bodyGrad; c.fill();
  
  // 3. Inner swirl
  const swirlGrad = c.createRadialGradient(cx + radius * 0.15, cy + radius * 0.1, radius * 0.1, cx + radius * 0.1, cy + radius * 0.05, radius * 0.6);
  swirlGrad.addColorStop(0, 'rgba(0,0,0,0.12)');
  swirlGrad.addColorStop(1, 'rgba(0,0,0,0)');
  c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2);
  c.fillStyle = swirlGrad; c.fill();
  
  // 4. Fresnel rim
  const rimGrad = c.createRadialGradient(cx, cy, radius * 0.7, cx, cy, radius);
  rimGrad.addColorStop(0, 'rgba(0,0,0,0)');
  rimGrad.addColorStop(0.8, 'rgba(0,0,0,0)');
  rimGrad.addColorStop(1, 'rgba(0,0,0,0.3)');
  c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2);
  c.fillStyle = rimGrad; c.fill();
  
  // 5. Window reflection
  c.save();
  c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.clip();
  c.beginPath();
  c.ellipse(cx - radius * 0.28, cy - radius * 0.32, radius * 0.38, radius * 0.25, -0.5, 0, Math.PI * 2);
  const reflGrad = c.createRadialGradient(cx - radius * 0.28, cy - radius * 0.32, 0, cx - radius * 0.28, cy - radius * 0.32, radius * 0.38);
  reflGrad.addColorStop(0, 'rgba(255,255,255,0.65)');
  reflGrad.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  reflGrad.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = reflGrad; c.fill();
  c.restore();
  
  // 6. Specular highlight
  c.beginPath(); c.arc(cx - radius * 0.2, cy - radius * 0.35, radius * 0.08, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();
  
  // 7. Secondary reflection
  c.beginPath(); c.arc(cx + radius * 0.22, cy + radius * 0.28, radius * 0.1, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.12)'; c.fill();
  
  marbleCache.set(key, { canvas: oc, pad });
  return { canvas: oc, pad };
}

function clearMarbleCache() { marbleCache.clear(); }

function drawMarble(x, y, radius, color, selected) {
  const sprite = getMarbleSprite(radius, color);
  // Draw cached sprite centered at (x, y)
  ctx.drawImage(sprite.canvas, 
    (x - sprite.pad) , (y - sprite.pad),
    sprite.pad * 2, sprite.pad * 2);
  
  // Selection ring drawn live (it pulses, can't cache)
  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#d4a017';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(212,160,23,0.8)';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
  }
}

function drawHollow(x, y) {
  // Outer rim — light catching the edge (top-left brighter)
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(140,100,65,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  
  // Carved hollow — deeper gradient
  const hollowGrad = ctx.createRadialGradient(x - 1, y - 1, 1, x, y, 13);
  hollowGrad.addColorStop(0, 'rgba(15,8,4,0.7)');
  hollowGrad.addColorStop(0.5, 'rgba(25,15,8,0.5)');
  hollowGrad.addColorStop(0.8, 'rgba(50,32,18,0.3)');
  hollowGrad.addColorStop(1, 'rgba(80,55,35,0.05)');
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fillStyle = hollowGrad;
  ctx.fill();
  
  // Light edge on top (as if light hits the rim from above-left)
  ctx.beginPath();
  ctx.arc(x, y, 12, Math.PI * 1.1, Math.PI * 1.8);
  ctx.strokeStyle = 'rgba(180,140,100,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawMarbles() {
  if (!gameState) return;
  
  for (let i = 0; i < gameState.board.length; i++) {
    const cell = gameState.board[i];
    const p = posCoords[i];
    if (!p) continue;
    
    if (animationData && i === animationData.toPos) continue;
    
    if (!cell) {
      drawHollow(p.x, p.y);
      continue;
    }
    
    const radius = MARBLE_SIZES[cell.size] || 16;
    const color = colors[cell.player] || '#888';
    const isSelected = gameState.currentPlayer === myPlayerIndex && cell.player === myPlayerIndex && selectedPos === i;
    
    drawMarble(p.x, p.y, radius, color, isSelected);
  }
}

function drawAnimatingMarble() {
  if (!animationData) return;
  const { fromCoord, toCoord, marble, progress } = animationData;
  
  // Ease-out cubic
  const t = 1 - Math.pow(1 - progress, 3);
  const x = fromCoord.x + (toCoord.x - fromCoord.x) * t;
  const y = fromCoord.y + (toCoord.y - fromCoord.y) * t;
  
  const radius = MARBLE_SIZES[marble.size] || 16;
  const color = colors[marble.player] || '#888';
  
  drawMarble(x, y, radius, color, false);
  
  // Golden glow trail while moving
  ctx.beginPath();
  ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(212, 160, 23, ${0.5 * (1 - t)})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function animateMove(from, to, marble, captures, onComplete) {
  if (!posCoords[from] || !posCoords[to]) {
    onComplete();
    return;
  }
  
  animating = true;
  const fromCoord = { ...posCoords[from] };
  const toCoord = { ...posCoords[to] };
  const dx = toCoord.x - fromCoord.x;
  const dy = toCoord.y - fromCoord.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const duration = Math.min(800, ANIM_BASE_DURATION + dist * ANIM_PER_PIXEL);
  
  animationData = {
    fromPos: from,
    toPos: to,
    fromCoord,
    toCoord,
    marble: { ...marble },
    progress: 0,
    captures: captures || [],
    startTime: performance.now(),
    duration
  };
  
  function step(timestamp) {
    if (!animationData) return;
    const elapsed = timestamp - animationData.startTime;
    animationData.progress = Math.min(1, elapsed / animationData.duration);
    
    render();
    
    if (animationData.progress < 1) {
      requestAnimationFrame(step);
    } else {
      animationData = null;
      animating = false;
      onComplete();
    }
  }
  
  requestAnimationFrame(step);
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
  const x = (e.clientX ?? e.changedTouches?.[0]?.clientX ?? e.touches?.[0]?.clientX) - rect.left;
  const y = (e.clientY ?? e.changedTouches?.[0]?.clientY ?? e.touches?.[0]?.clientY) - rect.top;
  const scaleX = (canvas.width / DPR) / rect.width;
  const scaleY = (canvas.height / DPR) / rect.height;
  const cx = x * scaleX;
  const cy = y * scaleY;
  
  let closest = -1;
  let minDist = Math.max(25, 35 * (canvas.width / DPR / 600));
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
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  const touch = e.changedTouches[0];
  handleClick(touch);
});

function handleClick(e) {
  if (!gameState || gameState.gameOver || animating) return;
  if (myPlayerIndex === -1) {
    showToast('Du schaust nur zu! 🍿');
    return;
  }
  if (gameState.currentPlayer !== myPlayerIndex) {
    showToast('Nicht dein Zug!');
    return;
  }
  
  const pos = getClickedPosition(e);
  if (pos < 0) return;
  
  // During chain jump, only allow clicking valid continuation targets
  if (chainActive !== null) {
    if (validTargets.includes(pos)) {
      if (soloMode) { soloMakeMove(chainActive, pos); }
      else { socket.emit('make-move', { from: chainActive, to: pos }); }
      return;
    }
    showToast('Springe weiter oder beende den Zug!');
    return;
  }
  
  // If clicking a valid target, make the move
  if (selectedPos !== null && validTargets.includes(pos)) {
    if (soloMode) { soloMakeMove(selectedPos, pos); }
    else { socket.emit('make-move', { from: selectedPos, to: pos }); }
    selectedPos = null;
    validTargets = [];
    render();
    return;
  }
  
  // If clicking own marble, select it
  const cell = gameState.board[pos];
  if (cell && cell.player === myPlayerIndex) {
    selectedPos = pos;
    if (soloMode) {
      soloGetMoves(pos);
    } else {
      validTargets = [];
      socket.emit('get-moves', { from: pos });
    }
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
  turnEl.textContent = myPlayerIndex === -1 ? `🍿 ${name} ist dran` : (isMyTurn ? '🎯 Du bist dran!' : `⏳ ${name} ist dran`);
  turnEl.style.background = color;
  turnEl.style.color = '#fff';
  
  // Marble counts with names
  const countsEl = document.getElementById('marble-counts');
  countsEl.innerHTML = gameState.marbleCount.map((c, i) => 
    `<div class="marble-count">
      <span class="marble-dot" style="background:${colors[i]}"></span>
      <span>${playerNames[i] || 'Spieler ' + (i+1)}: ${c}</span>
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

// Difficulty slider
const diffSlider = document.getElementById('difficulty');
const diffLabel = document.getElementById('diff-label');
const DIFF_NAMES = {
  1: 'Anfänger ⭐',
  2: 'Leicht ⭐⭐',
  3: 'Mittel ⭐⭐⭐',
  4: 'Schwer ⭐⭐⭐⭐',
  5: 'Unbesiegbar ⭐⭐⭐⭐⭐'
};
diffSlider.addEventListener('input', () => {
  diffLabel.textContent = DIFF_NAMES[diffSlider.value];
});

document.getElementById('ai-btn').addEventListener('click', () => {
  const name = document.getElementById('player-name').value.trim() || 'Spieler 1';
  const difficulty = parseInt(diffSlider.value);
  startSoloGame(name, numPlayers, difficulty);
});

document.getElementById('spectate-btn').addEventListener('click', () => {
  const difficulty = parseInt(diffSlider.value);
  startSoloSpectate(numPlayers, difficulty);
});

// Rules popup
function showRules() { document.getElementById('rules-overlay').classList.remove('hidden'); }
document.getElementById('rules-btn').addEventListener('click', showRules);
document.getElementById('rules-btn-game').addEventListener('click', showRules);
document.getElementById('close-rules-btn').addEventListener('click', () => {
  document.getElementById('rules-overlay').classList.add('hidden');
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
    if (soloMode) { soloEndTurn(); }
    else { socket.emit('end-turn'); }
  }
});

document.getElementById('surrender-btn').addEventListener('click', () => {
  if (!gameId) return;
  const isSpectator = myPlayerIndex === -1;
  const msg = isSpectator ? 'Spiel verlassen?' : 'Wirklich aufgeben?';
  if (confirm(msg)) {
    if (isSpectator) {
      socket.emit('leave-game');
    } else {
      socket.emit('surrender');
    }
    cleanupGameEvents(); // Issue #4: Cleanup when leaving game
    localStorage.removeItem('triumvirat-session');
    gameId = null;
    gameState = null;
    selectedPos = null;
    validTargets = [];
    chainActive = null;
    showScreen('lobby');
  }
});

document.getElementById('new-game-btn').addEventListener('click', () => {
  if (gameId) socket.emit('leave-game');
  cleanupGameEvents(); // Issue #4: Cleanup events when leaving game
  document.getElementById('game-over-overlay').classList.add('hidden');
  showScreen('lobby');
  gameId = null;
  gameState = null;
  selectedPos = null;
  validTargets = [];
  chainActive = null;
  moveTrails = {};
  localStorage.removeItem('triumvirat-session');
});

function saveSession() {
  if (!gameId) return;
  localStorage.setItem('triumvirat-session', JSON.stringify({
    gameId, playerIndex: myPlayerIndex, playerName: document.getElementById('player-name').value || 'Spieler'
  }));
}

function tryReconnect() {
  const saved = localStorage.getItem('triumvirat-session');
  if (!saved) return;
  try {
    const session = JSON.parse(saved);
    if (session.gameId) {
      socket.emit('reconnect-game', { gameId: session.gameId, playerIndex: session.playerIndex, playerName: session.playerName });
    }
  } catch (e) { localStorage.removeItem('triumvirat-session'); }
}

// Socket events
// Try reconnect on socket connection
socket.on('connect', () => {
  console.log('Socket connected, trying reconnect...');
  tryReconnect();
});

// Issue #4: Register all socket events for cleanup
registerSocketEvent('game-created', (data) => {
  gameId = data.gameId;
  myPlayerIndex = data.playerIndex;
  numPlayers = data.numPlayers;
  boardLayout = data.boardLayout;
  adjacency = data.adjacency;
  colors = data.colors;
  playerNames = data.playerNames;
  
  document.getElementById('invite-code').textContent = gameId;
  document.getElementById('game-id-display').textContent = `#${gameId}`;
  saveSession();
  
  if (!data.vsAI) {
    showScreen('waiting');
  }
  // AI games auto-start via game-start event
});

registerSocketEvent('game-joined', (data) => {
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

registerSocketEvent('player-joined', (data) => {
  const listEl = document.getElementById('player-list');
  listEl.innerHTML = data.players.map(p => 
    `<div class="player-item" style="background:${colors[p.index]}">${p.name}</div>`
  ).join('');
  const needed = data.needed - data.players.length;
  document.getElementById('needed-count').textContent = needed;
  document.getElementById('waiting-info').style.display = needed > 0 ? 'block' : 'none';
});

registerSocketEvent('game-start', (data) => {
  gameState = data.state;
  moveTrails = {};
  if (data.players) playerNames = data.players.map(p => p.name);
  showScreen('game');
  resizeCanvas();
  updateTurnDisplay();
  updateStatus(gameState.currentPlayer === myPlayerIndex ? 'Wähle eine Kugel aus!' : 'Warte auf den Gegner...');
  document.getElementById('surrender-btn').textContent = myPlayerIndex === -1 ? '🚪 Verlassen' : '🏳️ Aufgeben';
  saveSession();
});

registerSocketEvent('valid-moves', (data) => {
  if (data.from === selectedPos) {
    validTargets = data.moves;
    render();
  }
});

// Issue #6: Fixed animation queue race condition
function processAnimQueue() {
  if (animQueue.length === 0 || animLock) return;
  
  animLock = true;
  const next = animQueue.shift();
  
  handleMoveMade(next, () => {
    animLock = false;
    // Process next in queue with small delay
    if (animQueue.length > 0) {
      setTimeout(() => processAnimQueue(), 100);
    }
  });
}

// Issue #6: Updated to use queue with lock
const handleMoveEvent = (data) => {
  if (!gameId) return;  // Not in a game
  // Issue BUG-2: Prevent unbounded queue growth
  if (animQueue.length > 50) {
    console.warn('Animation queue overflow, clearing');
    animQueue = animQueue.slice(-10); // Keep last 10
  }
  const wasEmpty = animQueue.length === 0;
  animQueue.push(data);
  // Issue BUG-1: Fixed race condition
  if (wasEmpty && !animLock) {
    processAnimQueue();
  }
};
registerSocketEvent('move-made', handleMoveEvent);

// Issue #6: Added onComplete callback parameter
function handleMoveMade(data, onComplete) {
  // Track move trail
  const movingPlayer = gameState ? gameState.currentPlayer : 0;
  
  // If this player already has a trail and it's a chain jump, append to it
  if (chainActive !== null && moveTrails[movingPlayer]) {
    moveTrails[movingPlayer].segments.push({ from: data.from, to: data.to });
  } else {
    // New move — clear old trail for this player, start fresh
    moveTrails[movingPlayer] = { segments: [{ from: data.from, to: data.to }] };
  }
  
  // Get marble info from old state BEFORE updating
  const oldBoard = gameState ? gameState.board : null;
  const movingMarble = oldBoard ? oldBoard[data.from] : null;
  
  function applyMoveState() {
    // Issue #14: Prevent state restoration after surrender during animation
    if (!gameId) return; // Game was left during animation, ignore state update
    
    gameState = data.state;
    
    if (data.chainActive !== null && data.chainActive !== undefined) {
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
  }
  
  // Animate the move if we have position data
  if (movingMarble && posCoords[data.from] && posCoords[data.to]) {
    // Remove captured marbles from display immediately before animation
    if (data.captures && data.captures.length > 0) {
      for (const cap of data.captures) {
        if (gameState && gameState.board) {
          // Will be handled by state update
        }
      }
    }
    // Temporarily update board to remove marble from source (for clean animation)
    const tempState = JSON.parse(JSON.stringify(gameState));
    tempState.board[data.from] = null;
    // Remove captured marbles from temp display
    if (data.captures) {
      for (const cap of data.captures) {
        tempState.board[cap.pos] = null;
      }
    }
    gameState = tempState;
    
    animateMove(data.from, data.to, movingMarble, data.captures, () => {
      applyMoveState();
      if (onComplete) onComplete(); // Issue #6: Call callback
    });
  } else {
    applyMoveState();
    if (onComplete) onComplete(); // Issue #6: Call callback
  }
}

registerSocketEvent('turn-ended', (data) => {
  gameState = data.state;
  chainActive = null;
  selectedPos = null;
  validTargets = [];
  render();
  updateTurnDisplay();
  updateEndTurnButton();
  updateStatus(gameState.currentPlayer === myPlayerIndex ? 'Du bist dran!' : 'Warte auf den Gegner...');
});

registerSocketEvent('game-over', (data) => {
  if (!gameId) return;  // Already left the game
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
  localStorage.removeItem('triumvirat-session');
  // Issue #12: Clear trails after game over
  setTimeout(() => { moveTrails = {}; }, 3000);
});

registerSocketEvent('reconnected', (data) => {
  gameId = data.gameId;
  myPlayerIndex = data.playerIndex;
  numPlayers = data.numPlayers;
  boardLayout = data.boardLayout;
  adjacency = data.adjacency;
  colors = data.colors;
  playerNames = data.actualNames || data.playerNames;
  gameState = data.state;
  chainActive = data.state.chainActive || null;
  
  document.getElementById('game-id-display').textContent = `#${gameId}`;
  showScreen('game');
  resizeCanvas();
  updateTurnDisplay();
  updateEndTurnButton();
  updateStatus(gameState.currentPlayer === myPlayerIndex ? 'Du bist dran!' : 'Warte auf den Gegner...');
  document.getElementById('surrender-btn').textContent = myPlayerIndex === -1 ? '🚪 Verlassen' : '🏳️ Aufgeben';
  showToast('🔄 Spiel wiederhergestellt!');
});

registerSocketEvent('reconnect-failed', () => {
  localStorage.removeItem('triumvirat-session');
  // If we're on game screen, go back to lobby with message
  if (document.getElementById('game').classList.contains('active')) {
    showScreen('lobby');
    showToast('⚠️ Spiel nicht mehr verfügbar (Server-Neustart). Bitte neu starten!');
  }
});

registerSocketEvent('surrendered', (data) => {
  if (!gameId) return;  // Already left
  gameState = data.state;
  render();
  const overlay = document.getElementById('game-over-overlay');
  const winnerText = document.getElementById('winner-text');
  if (data.surrenderedPlayer === myPlayerIndex) {
    winnerText.textContent = '🏳️ Du hast aufgegeben!';
  } else {
    winnerText.textContent = `${data.surrenderedName} hat aufgegeben!`;
  }
  overlay.classList.remove('hidden');
  localStorage.removeItem('triumvirat-session');
});

registerSocketEvent('not-your-turn', () => showToast('Nicht dein Zug!'));
registerSocketEvent('invalid-move', (data) => showToast(data.error || 'Ungültiger Zug'));
registerSocketEvent('error-msg', (data) => showToast(data.message));
registerSocketEvent('player-disconnected', (data) => {
  showToast(`${playerNames[data.playerIndex]} hat das Spiel verlassen`);
});

// Connection lost indicator
socket.on('disconnect', () => {
  // Issue UX-1: Cancel running animations to prevent frozen state
  animationData = null;
  animating = false;
  animLock = false;
  animQueue = [];
  
  if (document.getElementById('game').classList.contains('active')) {
    render(); // Update display to show current state
    showToast('🔌 Verbindung verloren — versuche Neuverbindung...');
  }
});

// Resize handling (Issue #4: Track for cleanup)
function handleResize() {
  resizeCanvas();
}
window.addEventListener('resize', handleResize);

// Check URL for game code
const urlParams = new URLSearchParams(window.location.search);
const joinCode = urlParams.get('join');
if (joinCode) {
  document.getElementById('game-code').value = joinCode;
}

// ============================================================
// SOLO MODE — Client-side game, no server required
// ============================================================

const PLAYER_COLORS_LOCAL = ['#e74c3c', '#2ecc71', '#3498db'];
const PLAYER_NAMES_LOCAL = ['Rot', 'Grün', 'Blau'];

function startSoloGame(playerName, numP, difficulty) {
  // Load game-logic dynamically (should be cached after first load)
  if (!self.GameLogic) {
    showToast('⏳ Lade Spiel-Logik...');
    const s1 = document.createElement('script');
    s1.src = '/game-logic.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = '/ai-player.js';
      s2.onload = () => startSoloGame(playerName, numP, difficulty);
      document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
    return;
  }
  
  const { Game, getBoardLayout, ADJACENCY: adj } = self.GameLogic;
  
  soloMode = true;
  soloGame = new Game(numP);
  gameId = 'solo-' + Math.random().toString(36).substr(2, 6);
  myPlayerIndex = 0;
  numPlayers = numP;
  boardLayout = getBoardLayout();
  adjacency = adj;
  colors = PLAYER_COLORS_LOCAL;
  playerNames = [playerName];
  
  // Create AI players for positions 1+
  soloAIConfig = [];
  for (let i = 1; i < numP; i++) {
    const name = numP > 2 ? `🤖 Mako-Bot ${i}` : '🤖 Mako-Bot';
    playerNames.push(name);
    soloAIConfig.push({
      playerIndex: i,
      name,
      difficulty,
      moveHistory: [],
      plannedChain: []
    });
  }
  
  // Start Web Worker for AI
  if (soloAIWorker) soloAIWorker.terminate();
  soloAIWorker = new Worker('/ai-webworker.js');
  soloAIWorker.onmessage = handleAIWorkerMessage;
  
  gameState = soloGame.getState();
  moveTrails = {};
  chainActive = null;
  selectedPos = null;
  validTargets = [];
  
  showScreen('game');
  document.getElementById('game-id-display').textContent = '🎮 Solo';
  resizeCanvas();
  updateTurnDisplay();
  updateStatus('Wähle eine Kugel aus!');
  document.getElementById('surrender-btn').textContent = '🏳️ Aufgeben';
  
  // Don't save to localStorage for solo games (no reconnect needed)
}

function startSoloSpectate(numP, difficulty) {
  // Load game-logic if not yet loaded
  if (!self.GameLogic) {
    showToast('⏳ Lade Spiel-Logik...');
    const s1 = document.createElement('script');
    s1.src = '/game-logic.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = '/ai-player.js';
      s2.onload = () => startSoloSpectate(numP, difficulty);
      document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
    return;
  }
  
  const { Game, getBoardLayout, ADJACENCY: adj } = self.GameLogic;
  
  soloMode = true;
  soloGame = new Game(numP);
  gameId = 'spectate-' + Math.random().toString(36).substr(2, 6);
  myPlayerIndex = -1; // Spectator
  numPlayers = numP;
  boardLayout = getBoardLayout();
  adjacency = adj;
  colors = PLAYER_COLORS_LOCAL;
  playerNames = [];
  
  // All players are AI
  soloAIConfig = [];
  for (let i = 0; i < numP; i++) {
    const name = `🤖 Mako-Bot ${i + 1}`;
    playerNames.push(name);
    soloAIConfig.push({
      playerIndex: i,
      name,
      difficulty,
      moveHistory: [],
      plannedChain: []
    });
  }
  
  if (soloAIWorker) soloAIWorker.terminate();
  soloAIWorker = new Worker('/ai-webworker.js');
  soloAIWorker.onmessage = handleAIWorkerMessage;
  
  gameState = soloGame.getState();
  moveTrails = {};
  chainActive = null;
  selectedPos = null;
  validTargets = [];
  
  showScreen('game');
  document.getElementById('game-id-display').textContent = '👀 Spectate';
  document.getElementById('surrender-btn').textContent = '🚪 Verlassen';
  resizeCanvas();
  updateTurnDisplay();
  updateStatus('KI vs KI — lehne dich zurück! 🍿');
  
  // Kick off first AI turn
  soloTriggerAI();
}

function soloGetMoves(from) {
  if (!soloGame) return;
  
  if (soloGame.chainActive !== null) {
    if (from !== soloGame.chainActive) {
      validTargets = [];
      return;
    }
    const jumps = soloGame.getContinuationJumps(from);
    validTargets = jumps.map(m => m.to);
    return;
  }
  
  const moves = soloGame.getValidMoves(from);
  validTargets = moves.map(m => m.to);
}

function soloMakeMove(from, to) {
  if (!soloGame || soloGame.gameOver) return;
  
  const result = soloGame.makeMove(from, to);
  if (!result.valid) {
    showToast(result.error || 'Ungültiger Zug');
    return;
  }
  
  // Record trail — gameState still has OLD state (before makeMove), so currentPlayer is correct
  const movingPlayer = gameState.currentPlayer;
  moveTrails[movingPlayer] = moveTrails[movingPlayer] || { segments: [] };
  moveTrails[movingPlayer].segments.push({ from, to });
  
  gameState = soloGame.getState();
  
  // Run animation
  selectedPos = null;
  validTargets = [];
  
  if (result.chainActive !== null && result.chainActive !== undefined) {
    chainActive = result.chainActive;
    const jumps = soloGame.getContinuationJumps(chainActive);
    validTargets = jumps.map(m => m.to);
    updateEndTurnButton();
  } else {
    chainActive = null;
    updateEndTurnButton();
    // Clear trails for the current player (move complete)
    moveTrails[movingPlayer] = { segments: [{ from, to }] };
  }
  
  render();
  updateTurnDisplay();
  
  if (soloGame.gameOver) {
    soloShowGameOver();
    return;
  }
  
  if (chainActive === null) {
    updateStatus('Warte auf den Gegner...');
    soloTriggerAI();
  } else {
    updateStatus('Kettensprung! Klicke weiter oder beende den Zug.');
  }
}

function soloEndTurn() {
  if (!soloGame || soloGame.chainActive === null) return;
  
  const player = soloGame.currentPlayer;
  soloGame.endTurn();
  gameState = soloGame.getState();
  chainActive = null;
  validTargets = [];
  selectedPos = null;
  updateEndTurnButton();
  render();
  updateTurnDisplay();
  
  if (soloGame.gameOver) {
    soloShowGameOver();
    return;
  }
  
  updateStatus('Warte auf den Gegner...');
  soloTriggerAI();
}

function soloTriggerAI() {
  if (!soloGame || soloGame.gameOver || !soloAIWorker) return;
  
  const currentPlayer = soloGame.currentPlayer;
  const aiConf = soloAIConfig.find(a => a.playerIndex === currentPlayer);
  if (!aiConf) {
    // Human's turn
    updateStatus('Wähle eine Kugel aus!');
    return;
  }
  
  // Delay for natural feel
  const delay = 800 + Math.random() * 700;
  setTimeout(() => {
    if (!soloGame || soloGame.gameOver) return;
    soloAIWorker.postMessage({
      type: 'chooseMove',
      gameState: soloSerializeGame(),
      aiConfig: aiConf
    });
  }, delay);
}

function handleAIWorkerMessage(e) {
  const msg = e.data;
  
  if (msg.type === 'moveResult') {
    if (!soloGame || soloGame.gameOver) return;
    
    // Sync AI history
    const aiConf = soloAIConfig.find(a => a.playerIndex === soloGame.currentPlayer);
    if (aiConf && msg.moveHistory) aiConf.moveHistory = msg.moveHistory;
    if (aiConf && msg.plannedChain) aiConf.plannedChain = msg.plannedChain;
    
    const move = msg.move;
    if (!move) return;
    
    const player = soloGame.currentPlayer;
    const result = soloGame.makeMove(move.from, move.to);
    if (!result.valid) return;
    
    const movingMarble = soloGame.board[move.to]; // marble is at destination after makeMove
    const captures = result.captures || [];
    moveTrails[player] = { segments: [{ from: move.from, to: move.to }] };
    gameState = soloGame.getState();
    
    // Animate the AI move
    animateMove(move.from, move.to, movingMarble, captures, () => {
      render();
      updateTurnDisplay();
      
      if (soloGame.gameOver) {
        soloShowGameOver();
        return;
      }
      
      if (result.chainActive !== null) {
        // AI continues chain
        soloAIContinueChain();
      } else {
        // Check if next player is also AI
        soloTriggerAI();
      }
    });
    
  } else if (msg.type === 'continuationResult') {
    if (!soloGame || soloGame.gameOver) return;
    
    const aiConf = soloAIConfig.find(a => a.playerIndex === soloGame.currentPlayer);
    if (aiConf && msg.plannedChain) aiConf.plannedChain = msg.plannedChain;
    
    if (!msg.move) {
      // AI ends chain
      const player = soloGame.currentPlayer;
      soloGame.endTurn();
      gameState = soloGame.getState();
      render();
      updateTurnDisplay();
      
      if (soloGame.gameOver) { soloShowGameOver(); return; }
      soloTriggerAI();
      return;
    }
    
    const player = soloGame.currentPlayer;
    const result = soloGame.makeMove(msg.move.from, msg.move.to);
    if (!result.valid) {
      soloGame.endTurn();
      gameState = soloGame.getState();
      render();
      updateTurnDisplay();
      soloTriggerAI();
      return;
    }
    
    const contMarble = soloGame.board[msg.move.to];
    const contCaptures = result.captures || [];
    moveTrails[player] = moveTrails[player] || { segments: [] };
    moveTrails[player].segments.push({ from: msg.move.from, to: msg.move.to });
    gameState = soloGame.getState();
    
    animateMove(msg.move.from, msg.move.to, contMarble, contCaptures, () => {
      render();
      if (soloGame.gameOver) { soloShowGameOver(); return; }
      if (result.chainActive !== null) {
        soloAIContinueChain();
      } else {
        soloTriggerAI();
      }
    });
    
  } else if (msg.type === 'error') {
    console.error('AI Worker error:', msg.error);
  }
}

function soloAIContinueChain() {
  if (!soloGame || soloGame.gameOver || soloGame.chainActive === null) return;
  
  const aiConf = soloAIConfig.find(a => a.playerIndex === soloGame.currentPlayer);
  if (!aiConf) return;
  
  const delay = 500 + Math.random() * 400;
  setTimeout(() => {
    if (!soloGame || soloGame.gameOver) return;
    soloAIWorker.postMessage({
      type: 'chooseContinuation',
      gameState: soloSerializeGame(),
      aiConfig: aiConf
    });
  }, delay);
}

function soloSerializeGame() {
  return {
    board: soloGame.board.map(c => c ? { ...c } : null),
    currentPlayer: soloGame.currentPlayer,
    numPlayers: soloGame.numPlayers,
    gameOver: soloGame.gameOver,
    winner: soloGame.winner,
    chainActive: soloGame.chainActive,
    lastJumpedOver: soloGame.lastJumpedOver,
    cornerForced: soloGame.cornerForced ? { ...soloGame.cornerForced } : {},
    moveHistory: soloGame.moveHistory || []
  };
}

function soloShowGameOver() {
  const overlay = document.getElementById('game-over-overlay');
  const winnerText = document.getElementById('winner-text');
  if (soloGame.winner === myPlayerIndex) {
    winnerText.textContent = '🏆 Du hast gewonnen!';
  } else {
    const name = playerNames[soloGame.winner] || 'Gegner';
    winnerText.textContent = `${name} hat gewonnen!`;
  }
  overlay.classList.remove('hidden');
  
  // Cleanup
  if (soloAIWorker) { soloAIWorker.terminate(); soloAIWorker = null; }
}

// Override surrender for solo mode
document.getElementById('surrender-btn').addEventListener('click', (e) => {
  if (!soloMode || !soloGame) return; // let original handler run
  e.stopImmediatePropagation();
  if (confirm('Wirklich aufgeben?')) {
    if (soloAIWorker) { soloAIWorker.terminate(); soloAIWorker = null; }
    soloMode = false;
    soloGame = null;
    gameId = null;
    gameState = null;
    showScreen('lobby');
  }
}, true); // capture phase — runs before the original handler

// Override new-game for solo mode
document.getElementById('new-game-btn').addEventListener('click', () => {
  if (soloMode) {
    if (soloAIWorker) { soloAIWorker.terminate(); soloAIWorker = null; }
    soloMode = false;
    soloGame = null;
  }
}, true); // capture phase
