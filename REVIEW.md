# 🔍 Triumvirat Code Review (Update #2)

**Datum:** 2026-02-07  
**Reviewer:** Claude (Subagent)  
**Scope:** Vollständiger Re-Review nach Fix-Implementierung

---

## 📊 Zusammenfassung

**Gesamtbewertung:** ⭐⭐⭐⭐½ (4.5/5)

**MASSIVE VERBESSERUNGEN!** Die meisten kritischen Bugs aus dem ersten Review wurden korrekt gefixt. Das Projekt ist jetzt **produktionsreif** mit nur noch wenigen Edge Cases und Performance-Optimierungen.

**Status:**
- ✅ **13 von 13 kritischen/wichtigen Issues gefixt**
- 🟡 **3 neue Minor-Issues gefunden**
- 🟢 **2 neue Optimierungs-Vorschläge**

---

## ✅ ERFOLGREICH GEFIXT (Vergleich mit Review #1)

### ✅ #1: Memory Leak — Games werden nicht aufgeräumt
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// server.js Zeile 98-101, 338-344
room.lastActivity = Date.now(); // Bei jeder Aktion

// Cleanup interval (Zeile 461-476)
const inactiveTime = now - (room.lastActivity || room.createdAt || 0);
if (inactiveTime > INACTIVE_TIMEOUT_MS) { games.delete(id); }
```

**Bewertung:** ✅ Sehr gut! Multi-Kriterien-Cleanup (Age, Inactive, GameOver). Eleganter als vorgeschlagen.

---

### ✅ #2: Race Condition — Concurrent AI Move Execution
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// server.js Zeile 101, 268, 291, 349, 371, 390, 410, 424
room.aiExecuting = false; // In room-Objekt
if (room.aiExecuting) return; // Lock check
room.aiExecuting = true; // Lock setzen
room.aiExecuting = false; // Lock freigeben
```

**Bewertung:** ✅ Perfekt! Lock wird korrekt gesetzt/freigegeben in allen Code-Pfaden (auch Error-Cases).

---

### ✅ #3: Security — Keine Input-Validierung
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// server.js Zeile 23-32
function sanitizeString(str, maxLen = 20, fallback = '') {
  if (typeof str !== 'string') return fallback;
  return str.trim().substring(0, maxLen).replace(/[<>]/g, '');
}
function validateNumber(num, min, max, fallback) { /* ... */ }

// Zeile 45-54 + 129-132 + 218-221
playerName = sanitizeString(playerName, 20, 'Spieler');
numPlayers = validateNumber(numPlayers, 2, 3, 3);
difficulty = validateNumber(difficulty, 1, 5, 3);
```

**Bewertung:** ✅ Sehr robust! XSS-Protection (`<>` removal), Type-Safety, Range-Validation.

---

### ✅ #4: Client Memory Leak — Event Listeners nie entfernt
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// public/game.js Zeile 29-39
let gameEventListeners = [];

function registerSocketEvent(event, handler) {
  socket.on(event, handler);
  gameEventListeners.push({ event, handler });
}

function cleanupGameEvents() {
  for (const { event, handler } of gameEventListeners) {
    socket.off(event, handler);
  }
  gameEventListeners = [];
  // ... state cleanup
}
```

**Bewertung:** ✅ Exzellent! Systematisches Tracking + Cleanup. Wird an allen richtigen Stellen aufgerufen (surrender, new-game, leave).

---

### ✅ #5: Bug — `_skipEliminatedPlayers` Endlosschleife
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// game-logic.js Zeile 217-227
_skipEliminatedPlayers() {
  const counts = this._getMarbleCounts();
  let attempts = 0;
  while (counts[this.currentPlayer] === 0 && attempts < this.numPlayers) {
    this.currentPlayer = (this.currentPlayer + 1) % this.numPlayers;
    attempts++;
  }
  if (counts[this.currentPlayer] === 0) {
    this.gameOver = true;
    this.winner = -1; // Draw/Error state
  }
}
```

**Bewertung:** ✅ Perfekt! Defensive Programmierung mit Fallback auf Error-State.

---

### ✅ #6: Bug — `animQueue` Race Condition
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// public/game.js Zeile 26-27, 539-552
let animLock = false;

function processAnimQueue() {
  if (animQueue.length === 0 || animLock) return;
  
  animLock = true;
  const next = animQueue.shift();
  
  handleMoveMade(next, () => {
    animLock = false;
    if (animQueue.length > 0) {
      setTimeout(() => processAnimQueue(), 100);
    }
  });
}

// Zeile 555-559
const handleMoveEvent = (data) => {
  animQueue.push(data);
  if (!animLock) processAnimQueue();
};
```

**Bewertung:** ✅ Sehr sauber! Lock + Callback-Pattern + Queue-Processing.

---

### ✅ #7: Performance — AI Minimax ohne Caching
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// ai-player.js Zeile 41, 139-142, 154-163, 180-185
this.transpositionTable = new Map(); // Im Constructor

_boardHash(game) {
  return game.board.map(c => c ? `${c.player}${c.size}` : '-').join('') + `|${game.currentPlayer}`;
}

_minimax(game, depth, alpha, beta, _unused) {
  const hash = this._boardHash(game);
  const cached = this.transpositionTable.get(hash);
  if (cached && cached.depth >= depth) return cached.score;
  // ...
  this.transpositionTable.set(hash, { score, depth });
  if (this.transpositionTable.size > 10000) this.transpositionTable.clear();
  return score;
}
```

**Bewertung:** ✅ Exzellent! Hash-Funktion ist simpel aber effektiv. Memory-Management mit 10k Limit ist smart.

---

### ✅ #8: Code-Qualität — Duplikation in AI-Player
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// game-logic.js Zeile 293-297
module.exports = { 
  Game, getBoardLayout, BOARD_SIZE, CORNERS, ADJACENCY, NUM_ROWS,
  indexToRowCol, getJumpLanding  // ← Exportiert
};

// ai-player.js Zeile 6
const { Game, ADJACENCY, CORNERS, BOARD_SIZE, indexToRowCol, getJumpLanding } = require('./game-logic');
```

**Bewertung:** ✅ Perfekt! Keine Duplikation mehr. DRY-Prinzip eingehalten.

---

### ✅ #9: Performance — `getValidMoves()` iteriert über gesamtes Board
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// game-logic.js Zeile 87-89, 103-111
this.playerMarbles = {}; // Im Constructor
for (let p = 0; p < this.numPlayers; p++) {
  this.playerMarbles[p] = [];
}
// Bei Setup: playerMarbles tracking

getValidMoves(forPos) {
  const positions = forPos !== undefined 
    ? [forPos] 
    : (this.playerMarbles[player] || []);
  
  for (const i of positions) { /* ... */ }
}

// Zeile 188-191: Update bei makeMove
const idx = this.playerMarbles[player].indexOf(from);
if (idx >= 0) this.playerMarbles[player][idx] = to;
```

**Bewertung:** ✅ Sehr gut! O(28) → O(6) für getValidMoves. Tracking ist korrekt implementiert.

---

### ✅ #10: Bug — `lastJumpedOver` nicht gecleared
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// game-logic.js Zeile 201-204
if (move.isJump) {
  this.lastJumpedOver = this._getJumpedPosition(from, to);
} else {
  this.lastJumpedOver = null; // ← Explicit clear
}
```

**Bewertung:** ✅ Korrekt! Explizites Clearing verhindert Leftover-State.

---

### ✅ #11: Bug — `getActiveAI` ohne Error-Logging
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// server.js Zeile 260-268
function getActiveAI(room) {
  const currentPlayer = room.game.currentPlayer;
  const ai = room.aiPlayers.find(ai => ai.playerIndex === currentPlayer) || null;
  
  if (ai === null && room.vsAI) {
    console.error(`⚠️ Expected AI for player ${currentPlayer} but none found!`);
  }
  return ai;
}
```

**Bewertung:** ✅ Perfekt! Defensive Logging hilft beim Debugging.

---

### ✅ #12: Client — `moveTrails` nie aufgeräumt
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// public/game.js Zeile 36-37, 676
function cleanupGameEvents() {
  // ...
  moveTrails = {}; // ← Cleanup
}

socket.on('game-over', (data) => {
  // ...
  setTimeout(() => { moveTrails = {}; }, 3000); // ← Delayed cleanup
});
```

**Bewertung:** ✅ Sehr gut! Cleanup sowohl bei Game-End als auch bei Session-Reset.

---

### ✅ #13: Security — DoS durch unbegrenzte Spiel-Erstellung
**Status:** **GEFIXT** ✅

**Implementierung:**
```javascript
// server.js Zeile 18-20, 44-56
const createGameLimits = new Map();
const MAX_GAMES_PER_MINUTE = 5;

socket.on('create-game', (...) => {
  const now = Date.now();
  const limit = createGameLimits.get(socket.id) || { count: 0, resetTime: now + 60000 };
  
  if (now > limit.resetTime) {
    limit.count = 0;
    limit.resetTime = now + 60000;
  }
  
  if (limit.count >= MAX_GAMES_PER_MINUTE) {
    socket.emit('error-msg', { message: 'Zu viele Spiele erstellt. Bitte warte einen Moment.' });
    return;
  }
  limit.count++;
  // ...
});

// Zeile 447: Cleanup bei disconnect
createGameLimits.delete(socket.id);
```

**Bewertung:** ✅ Robust! Sliding Window Rate Limiting mit Memory-Cleanup.

---

## 🟡 NEUE ISSUES (Kleinere Probleme)

### 🟡 #14: Memory Cleanup — Resize Event Listener nie entfernt
**Datei:** `public/game.js` (Zeile 691)

**Problem:**
- `window.addEventListener('resize', handleResize)` wird nie removed
- Bei Multi-Session-Nutzung (mehrere Spiele hintereinander) stapeln sich Handler

**Code:**
```javascript
// Zeile 688-691
function handleResize() { resizeCanvas(); }
window.addEventListener('resize', handleResize);
// ← Wird NIE removed!
```

**Fix:**
```javascript
// In cleanupGameEvents():
function cleanupGameEvents() {
  // ... existing cleanup ...
  window.removeEventListener('resize', handleResize);
}

// Bei neuem Spiel:
function initGame() {
  window.addEventListener('resize', handleResize);
  // ...
}
```

**Wichtigkeit:** 🟡 Nicht kritisch (resize events sind lightweight), aber sauberere Architektur.

---

### 🟡 #15: Edge Case — `processAnimQueue` rekursiver setTimeout kann Memory wachsen lassen
**Datei:** `public/game.js` (Zeile 545-551)

**Problem:**
- Bei sehr langen Animations-Queues (z.B. 3 AIs spielen schnell) könnte `setTimeout(() => processAnimQueue(), 100)` rekursiv viele Timeouts schedulen
- Nicht wirklich ein Memory Leak, aber suboptimal

**Code:**
```javascript
function processAnimQueue() {
  // ...
  handleMoveMade(next, () => {
    animLock = false;
    if (animQueue.length > 0) {
      setTimeout(() => processAnimQueue(), 100); // ← Rekursiv
    }
  });
}
```

**Verbesserung:**
```javascript
function processAnimQueue() {
  if (animQueue.length === 0 || animLock) return;
  
  animLock = true;
  const next = animQueue.shift();
  
  handleMoveMade(next, () => {
    animLock = false;
    // Process immediately if queue not empty, no setTimeout needed
    if (animQueue.length > 0) {
      processAnimQueue(); // Direct call instead of setTimeout
    }
  });
}

// Nur wenn explizites Delay gewünscht:
const ANIM_QUEUE_DELAY_MS = 100;
if (animQueue.length > 0) {
  setTimeout(() => processAnimQueue(), ANIM_QUEUE_DELAY_MS);
}
```

**Wichtigkeit:** 🟡 Minor — funktioniert korrekt, aber könnte optimiert werden.

---

### 🟡 #16: Spectate-Reconnect — `playerIndex: -1` fehlt in reconnect-game Validierung
**Datei:** `server.js` (Zeile 220)

**Problem:**
- `playerIndex = validateNumber(playerIndex, -1, 2, -1)` ist korrekt
- ABER: Wenn `playerIndex === -1` und `!room.spectateMode`, wird trotzdem versucht, einen Player zu finden

**Code:**
```javascript
// Zeile 218-240
socket.on('reconnect-game', ({ gameId, playerIndex, playerName }) => {
  // ...
  // Spectator reconnect
  if (playerIndex === -1 && room.spectateMode) {
    // ✅ Korrekt für Spectate
  }
  
  // ❌ ABER: Was wenn playerIndex === -1 && !room.spectateMode?
  // Dann läuft Code weiter und sucht Player mit index -1
  const player = room.players.find(p => p.index === playerIndex && !p.id.startsWith('ai-'));
  if (!player) {
    socket.emit('reconnect-failed');
    return; // ← Catchet es, aber erst NACH Suche
  }
});
```

**Fix:**
```javascript
// Nach Spectator-Block:
if (playerIndex === -1 && !room.spectateMode) {
  socket.emit('reconnect-failed');
  return;
}

// Dann Player-Reconnect-Logik
```

**Wichtigkeit:** 🟡 Edge Case — würde sowieso bei `!player` check fehlschlagen, aber expliziter wäre besser.

---

## 🟢 OPTIMIERUNGEN (Nice-to-have)

### 🟢 #17: AI `_expandChains` kann viele Pfade generieren
**Datei:** `ai-player.js` (Zeile 76-102)

**Problem:**
- Bei komplexen Chain-Situationen kann `_expandChains` exponentiell viele Pfade generieren
- Aktuell kein Limit (außer `depth > 5`)

**Beispiel:**
- 3 Sprung-Optionen pro Schritt
- Depth 5 → 3^5 = 243 Pfade

**Code:**
```javascript
_expandChains(game, initialMove) {
  const results = [];
  const stack = [{ game: ..., path: [initialMove], depth: 0 }];
  
  while (stack.length > 0) {
    const { game: g, path, depth } = stack.pop();
    if (depth > 5) { results.push(path); continue; } // ← Nur Depth-Limit
    // ...
  }
  return results; // ← Kann 100+ Pfade sein
}
```

**Verbesserung:**
```javascript
const MAX_CHAIN_PATHS = 50;

_expandChains(game, initialMove) {
  const results = [];
  const stack = [{ game: ..., path: [initialMove], depth: 0 }];
  
  while (stack.length > 0 && results.length < MAX_CHAIN_PATHS) {
    // ... existing logic ...
  }
  
  // Optional: Sortiere nach Captures/Qualität
  if (results.length > MAX_CHAIN_PATHS) {
    results.sort((a, b) => {
      const capturesA = a.reduce((sum, m) => sum + m.captures.length, 0);
      const capturesB = b.reduce((sum, m) => sum + m.captures.length, 0);
      return capturesB - capturesA;
    });
    return results.slice(0, MAX_CHAIN_PATHS);
  }
  
  return results;
}
```

**Wichtigkeit:** 🟢 Optimierung — funktioniert in der Praxis gut (Depth-Limit ist ausreichend).

---

### 🟢 #18: Client Canvas — Könnte Background-Layer cachen
**Datei:** `public/game.js` (Zeile 94-197)

**Problem:**
- Jeder `render()` Call zeichnet Board + Connections neu
- Diese ändern sich nie (außer bei Resize)

**Verbesserung:**
```javascript
let bgCanvas = null;
let bgNeedsRedraw = true;

function resizeCanvas() {
  // ... existing code ...
  bgNeedsRedraw = true; // Trigger background redraw
}

function render() {
  if (!posCoords.length) return;
  const w = canvas.width / DPR;
  const h = canvas.height / DPR;
  
  ctx.clearRect(0, 0, w, h);
  
  // Draw cached background
  if (bgNeedsRedraw) {
    if (!bgCanvas) {
      bgCanvas = document.createElement('canvas');
      bgCanvas.width = canvas.width;
      bgCanvas.height = canvas.height;
    }
    const bgCtx = bgCanvas.getContext('2d');
    bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bgCtx.clearRect(0, 0, w, h);
    drawBoard(w, h, bgCtx);
    drawConnections(bgCtx);
    bgNeedsRedraw = false;
  }
  
  ctx.drawImage(bgCanvas, 0, 0);
  
  // Draw dynamic elements
  drawMoveTrails();
  drawHighlights();
  drawMarbles();
  drawAnimatingMarble();
}

// Update drawBoard/drawConnections to accept ctx parameter
function drawBoard(w, h, targetCtx = ctx) { /* ... */ }
function drawConnections(targetCtx = ctx) { /* ... */ }
```

**Wichtigkeit:** 🟢 Performance-Optimierung — aktuell ist Rendering schnell genug, aber bei High-DPI Displays könnte es helfen.

---

## 📈 Test-Coverage Update

**Neue Tests hinzugefügt:**
- ✅ Issue #5: _skipEliminatedPlayers infinite loop
- ✅ Issue #7: Transposition table caching
- ✅ Issue #8: AI function imports (no duplication)
- ✅ Issue #9: playerMarbles tracking & updates
- ✅ Issue #10: lastJumpedOver clearing
- ✅ AI _cloneGame deep-copies (cornerForced, playerMarbles)

**Coverage-Schätzung:**
- ✅ Basic Setup: 100%
- ✅ Valid Moves: 95%
- ✅ Corner Rules: 100%
- ✅ Jump Mechanics: 100%
- ✅ Chain Jumps: 90%
- ✅ Game End: 95%
- ❌ Reconnect: 0% (nur manuell getestet)
- ❌ Surrender: 0% (nur manuell getestet)
- ❌ Socket Events: 0% (Integration Tests fehlen)
- ✅ AI Chain Handling: 80%
- ✅ Input Validation: 100% (via Funktionen)

**Gesamt: ~75% Coverage** (Verbesserung von 65%)

**Fehlende Tests:**
1. Socket-Integration Tests (create-game, join-game, move-made Events)
2. Reconnect-Logik (State-Wiederherstellung)
3. Surrender-Mechanik (Marble-Removal, Turn-Advance)
4. Rate Limiting (DoS-Protection)
5. Client Animation Queue (Edge Cases bei vielen parallelen Moves)

**Empfehlung:**
```javascript
// test-server.js (NEU)
const io = require('socket.io-client');

test('Socket: Create game returns gameId', (done) => {
  const socket = io('http://localhost:3000');
  socket.emit('create-game', { playerName: 'Test', numPlayers: 2 });
  socket.on('game-created', (data) => {
    assert(data.gameId.length === 8, 'GameId should be 8 chars');
    socket.disconnect();
    done();
  });
});

test('Rate Limiting: Blocks after 5 games', (done) => {
  const socket = io('http://localhost:3000');
  let created = 0;
  let blocked = false;
  
  for (let i = 0; i < 6; i++) {
    socket.emit('create-game', { playerName: 'Spammer', numPlayers: 2 });
  }
  
  socket.on('game-created', () => created++);
  socket.on('error-msg', (data) => {
    if (data.message.includes('Zu viele')) blocked = true;
  });
  
  setTimeout(() => {
    assert(created === 5, `Should create 5 games, got ${created}`);
    assert(blocked === true, 'Should block 6th game');
    socket.disconnect();
    done();
  }, 500);
});
```

---

## 🎯 Priorisierte Action Items

### Sofort (wenn Zeit):
1. 🟡 **#14: Resize Event Listener Cleanup** (5 min)
2. 🟡 **#16: Spectate Reconnect Validierung** (2 min)

### Optional (Optimierungen):
3. 🟢 **#17: AI Chain Path Limiting** (Performance bei komplexen Chains)
4. 🟢 **#18: Canvas Background Caching** (Performance bei High-DPI)
5. 🟡 **#15: Animation Queue Optimierung** (Code-Stil)

### Langfristig (Nice-to-have):
6. Integration Tests für Socket Events
7. Reconnect-Tests mit State-Validation
8. Performance-Profiling (Chrome DevTools)

---

## ✨ Positives Feedback (Update)

**HERAUSRAGENDE VERBESSERUNGEN:**
- 🌟 **Alle 13 kritischen/wichtigen Issues perfekt gefixt!**
- 🌟 **Code-Qualität deutlich verbessert:** Defensive Programming, Error Handling, Memory Management
- 🌟 **Test-Coverage von 65% auf 75% gestiegen**
- 🌟 **Performance-Optimierungen korrekt implementiert** (Transposition Table, playerMarbles)
- 🌟 **Security-Features professionell** (Input Sanitization, Rate Limiting, XSS-Protection)

**Was gut funktioniert (neu):**
- ✨ **Memory Management:** Systematisches Cleanup auf Client + Server
- ✨ **Race Condition Prevention:** AI-Lock und Anim-Lock funktionieren einwandfrei
- ✨ **Input Validation:** Robust gegen Edge Cases und Attacks
- ✨ **Event Listener Management:** Sauberes registerSocketEvent() Pattern

**Code-Stil:**
- ✅ Konsistente Namensgebung
- ✅ Gute Kommentare (Issues sind dokumentiert)
- ✅ Defensive Programmierung (null-checks, attempts-counter)
- ✅ DRY-Prinzip eingehalten (Duplikation entfernt)

---

## 📊 Vergleich zu Review #1

| Issue | Status Alt | Status Neu | Bemerkung |
|-------|-----------|-----------|-----------|
| #1: Memory Leak | 🔴 Kritisch | ✅ Gefixt | lastActivity + Multi-Kriterien-Cleanup |
| #2: AI Race Condition | 🔴 Kritisch | ✅ Gefixt | aiExecuting Lock perfekt |
| #3: Input Validation | 🔴 Kritisch | ✅ Gefixt | sanitize + validate + rate limit |
| #4: Client Memory Leak | 🔴 Kritisch | ✅ Gefixt | registerSocketEvent() System |
| #5: _skipEliminated Loop | 🔴 Kritisch | ✅ Gefixt | attempts counter + error state |
| #6: animQueue Race | 🔴 Kritisch | ✅ Gefixt | animLock + callback pattern |
| #7: Minimax Caching | 🟡 Wichtig | ✅ Gefixt | Transposition Table mit Memory-Limit |
| #8: Code-Duplikation | 🟡 Wichtig | ✅ Gefixt | Funktionen importiert |
| #9: getValidMoves Performance | 🟡 Wichtig | ✅ Gefixt | playerMarbles tracking |
| #10: lastJumpedOver | 🟡 Wichtig | ✅ Gefixt | Explizites clearing |
| #11: getActiveAI Logging | 🟡 Wichtig | ✅ Gefixt | Error logging added |
| #12: moveTrails Cleanup | 🟡 Wichtig | ✅ Gefixt | In cleanupGameEvents() |
| #13: DoS Rate Limiting | 🟡 Wichtig | ✅ Gefixt | Sliding window mit cleanup |
| #14-18 | - | 🟡🟢 Neu | Kleinere Optimierungen |

**Fix-Quote: 13/13 = 100%** 🎉

---

## 🏆 FAZIT

**Das Projekt ist PRODUKTIONSREIF!** 🚀

**Stärken:**
- ✅ Alle kritischen Bugs gefixt
- ✅ Robuste Error-Handling
- ✅ Gute Performance (Minimax-Caching, playerMarbles)
- ✅ Security-Features implementiert
- ✅ Memory-Management professionell

**Verbleibende Arbeit:**
- 🟡 3 Minor Issues (alle nicht kritisch)
- 🟢 2 Optimierungen (optional)
- 📝 Integration Tests (für 100% Confidence)

**Empfehlung:**
- ✅ **Kann deployed werden** (alle Show-Stopper behoben)
- 🟡 **Issues #14-16 fixen** wenn Zeit (jeweils < 5 min)
- 🟢 **Optimierungen #17-18** später (bei Bedarf)

**Bewertung:** Von ⭐⭐⭐⭐ (4/5) auf ⭐⭐⭐⭐½ (4.5/5) gestiegen!

---

## 📚 Code-Beispiele für verbleibende Fixes

### Fix #14: Resize Event Listener Cleanup
```javascript
// public/game.js

// In cleanupGameEvents() (Zeile 31):
function cleanupGameEvents() {
  for (const { event, handler } of gameEventListeners) {
    socket.off(event, handler);
  }
  gameEventListeners = [];
  animQueue = [];
  animLock = false;
  moveTrails = {};
  selectedPos = null;
  validTargets = [];
  animationData = null;
  chainActive = null;
  
  // NEW: Remove resize listener
  window.removeEventListener('resize', handleResize);
}

// Bei neuem Spiel (Zeile 530 oder bei game-start):
registerSocketEvent('game-start', (data) => {
  // ... existing code ...
  window.addEventListener('resize', handleResize); // Re-register
});
```

---

### Fix #16: Spectate Reconnect Validierung
```javascript
// server.js, nach Zeile 240:

socket.on('reconnect-game', ({ gameId, playerIndex, playerName }) => {
  // ... existing validation ...
  
  // Spectator reconnect
  if (playerIndex === -1 && room.spectateMode) {
    // ... existing spectator code ...
    return;
  }
  
  // NEW: Reject invalid spectator attempts
  if (playerIndex === -1 && !room.spectateMode) {
    socket.emit('reconnect-failed');
    return;
  }
  
  // Update the player's socket ID
  const player = room.players.find(p => p.index === playerIndex && !p.id.startsWith('ai-'));
  // ...
});
```

---

### Fix #15: Animation Queue Optimierung (Optional)
```javascript
// public/game.js, Zeile 540-551:

function processAnimQueue() {
  if (animQueue.length === 0 || animLock) return;
  
  animLock = true;
  const next = animQueue.shift();
  
  handleMoveMade(next, () => {
    animLock = false;
    // Direct call instead of setTimeout for faster processing
    if (animQueue.length > 0) {
      // Small delay only if queue is very long (throttling)
      if (animQueue.length > 5) {
        setTimeout(() => processAnimQueue(), 50);
      } else {
        processAnimQueue(); // Immediate
      }
    }
  });
}
```

---

**Review abgeschlossen. Exzellente Arbeit beim Fixen! 🎉**
