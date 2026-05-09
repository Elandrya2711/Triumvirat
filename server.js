/**
 * Triumvirat - Game Server
 * Node.js + Express + Socket.io
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Game, getBoardLayout, ADJACENCY } = require('./game-logic');

const app = express();
const server = http.createServer(app);

const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .map(origin => {
    if (!origin || origin === '*') return origin;
    try { return new URL(origin).origin; } catch { return origin; }
  })
  .filter(Boolean);

function isAllowedOrigin(origin, host) {
  if (!origin) return true;
  if (configuredOrigins.includes('*')) return true;

  try {
    const parsed = new URL(origin);
    const normalizedOrigin = parsed.origin;
    if (configuredOrigins.includes(normalizedOrigin)) return true;

    // Browser WebSocket handshakes should come from the same site by default.
    return host && parsed.host === host;
  } catch {
    return false;
  }
}

const io = new Server(server, {
  allowRequest: (req, callback) => {
    if (isAllowedOrigin(req.headers.origin, req.headers.host)) {
      callback(null, true);
      return;
    }
    callback('origin not allowed', false);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Serve shared modules for browser (isomorphic game-logic + ai-player)
app.get('/game-logic.js', (req, res) => res.sendFile(path.join(__dirname, 'game-logic.js')));
app.get('/ai-player.js', (req, res) => res.sendFile(path.join(__dirname, 'ai-player.js')));

// Active games: gameId -> { game, players: [{id, name, socketId}], spectators: [] }
const games = new Map();

// Rate limiting for game creation and joining
const createGameLimits = new Map(); // client key -> { count, resetTime }
const joinGameLimits = new Map(); // client key -> { count, resetTime }
const MAX_GAMES_PER_MINUTE = 5;
const MAX_JOINS_PER_MINUTE = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const TRUST_PROXY = process.env.TRUST_PROXY !== 'false';

// Input sanitization helpers
function sanitizeString(str, maxLen = 20, fallback = '') {
  if (typeof str !== 'string') return fallback;
  return str.trim().substring(0, maxLen).replace(/[<>]/g, '');
}

function validateNumber(num, min, max, fallback) {
  const n = parseInt(num);
  if (isNaN(n) || n < min || n > max) return fallback;
  return n;
}

function getPayloadObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload;
}

function getClientKey(socket) {
  const forwardedFor = socket.handshake.headers['x-forwarded-for'];
  if (TRUST_PROXY && typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim().replace(/^::ffff:/, '');
  }
  return (socket.handshake.address || socket.id).replace(/^::ffff:/, '');
}

function checkRateLimit(limits, key, maxCount) {
  const now = Date.now();
  const limit = limits.get(key) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

  if (now > limit.resetTime) {
    limit.count = 0;
    limit.resetTime = now + RATE_LIMIT_WINDOW_MS;
  }

  if (limit.count >= maxCount) {
    limits.set(key, limit);
    return false;
  }

  limit.count++;
  limits.set(key, limit);
  return true;
}

function cleanupRateLimits(limits) {
  const now = Date.now();
  for (const [key, limit] of limits.entries()) {
    if (now > limit.resetTime) limits.delete(key);
  }
}

const PLAYER_COLORS = ['#e74c3c', '#2ecc71', '#3498db']; // Red, Green, Blue
const PLAYER_NAMES = ['Rot', 'Grün', 'Blau'];

function markPlayerDisconnected(socket, gameId) {
  const room = games.get(gameId);
  if (!room) return;

  io.to(gameId).emit('player-disconnected', {
    playerIndex: socket.playerIndex
  });

  const player = room.players.find(p => p.id === socket.id);
  if (player) player.disconnected = true;

  const humanPlayers = room.players.filter(p => !p.id.startsWith('ai-'));
  const allDisconnected = humanPlayers.every(p => p.disconnected);
  const activeHumans = humanPlayers.filter(p => !p.disconnected).length;
  const age = Date.now() - (room.createdAt || 0);

  // Delete if: (all humans disconnected AND game over) OR (no active humans AND game older than 2min)
  if ((allDisconnected && room.game.gameOver) || (activeHumans === 0 && age > 2 * 60 * 1000)) {
    games.delete(gameId);
    console.log(`Game ${gameId} deleted (disconnected cleanup)`);
  }
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create a new game
  socket.on('create-game', (payload) => {
    const data = getPayloadObject(payload);
    if (!data) {
      socket.emit('error-msg', { message: 'Ungültige Anfrage' });
      return;
    }
    let { playerName, numPlayers } = data;
    // Rate limiting (Issue #13)
    if (!checkRateLimit(createGameLimits, getClientKey(socket), MAX_GAMES_PER_MINUTE)) {
      socket.emit('error-msg', { message: 'Zu viele Spiele erstellt. Bitte warte einen Moment.' });
      return;
    }

    // Input validation (Issue #3)
    playerName = sanitizeString(playerName, 20, 'Spieler');
    numPlayers = validateNumber(numPlayers, 2, 3, 3);
    
    const gameId = uuidv4().substring(0, 8);
    const effectivePlayers = numPlayers || 3;
    // Random starting player for each new game
    const startingPlayer = Math.floor(Math.random() * effectivePlayers);
    const game = new Game(effectivePlayers, startingPlayer);
    
    const room = {
      game,
      numPlayers: effectivePlayers,
      players: [],
      spectators: [],
      started: false,
      vsAI: false,
      spectateMode: false,
      createdAt: Date.now(),
      lastActivity: Date.now(), // Issue #1: Track activity for memory leak fix
      lastStarter: startingPlayer,
      rematchVotes: null
    };

    room.players.push({ id: socket.id, name: playerName || 'Spieler 1', index: 0, reconnectToken: uuidv4(), disconnected: false });

    games.set(gameId, room);

    socket.join(gameId);
    socket.gameId = gameId;
    socket.playerIndex = 0;

    socket.emit('game-created', {
      gameId,
      playerIndex: 0,
      reconnectToken: room.players.find(p => p.index === 0)?.reconnectToken,
      numPlayers: effectivePlayers,
      boardLayout: getBoardLayout(),
      adjacency: ADJACENCY,
      colors: PLAYER_COLORS,
      playerNames: PLAYER_NAMES,
      vsAI: false,
      spectateMode: false
    });

    console.log(`Game ${gameId} created (${effectivePlayers} players)`);
  });

  // Join existing game
  socket.on('join-game', (payload) => {
    const data = getPayloadObject(payload);
    if (!data) {
      socket.emit('error-msg', { message: 'Ungültige Anfrage' });
      return;
    }
    let { gameId, playerName } = data;
    // Issue SEC-2: Rate limiting for join attempts
    if (!checkRateLimit(joinGameLimits, getClientKey(socket), MAX_JOINS_PER_MINUTE)) {
      socket.emit('error-msg', { message: 'Zu viele Join-Versuche. Bitte warte einen Moment.' });
      return;
    }

    // Input validation (Issue #3)
    gameId = sanitizeString(gameId, 12, '');
    playerName = sanitizeString(playerName, 20, 'Spieler');
    
    const room = games.get(gameId);
    if (!room) {
      socket.emit('error-msg', { message: 'Spiel nicht gefunden' });
      return;
    }
    if (room.players.length >= room.numPlayers) {
      socket.emit('error-msg', { message: 'Spiel ist voll' });
      return;
    }

    const playerIndex = room.players.length;
    room.players.push({ id: socket.id, name: playerName || `Spieler ${playerIndex + 1}`, index: playerIndex, reconnectToken: uuidv4(), disconnected: false });
    room.lastActivity = Date.now(); // Issue #1: Update activity

    socket.join(gameId);
    socket.gameId = gameId;
    socket.playerIndex = playerIndex;

    socket.emit('game-joined', {
      gameId,
      playerIndex,
      reconnectToken: room.players.find(p => p.index === playerIndex)?.reconnectToken,
      numPlayers: room.numPlayers,
      boardLayout: getBoardLayout(),
      adjacency: ADJACENCY,
      colors: PLAYER_COLORS,
      playerNames: PLAYER_NAMES
    });

    // Notify all players
    io.to(gameId).emit('player-joined', {
      players: room.players.map(p => ({ name: p.name, index: p.index })),
      needed: room.numPlayers
    });

    // Auto-start when full
    if (room.players.length === room.numPlayers) {
      room.started = true;
      io.to(gameId).emit('game-start', {
        state: room.game.getState(),
        players: room.players.map(p => ({ name: p.name, index: p.index }))
      });
    }
  });

  // Request valid moves for a position
  socket.on('get-moves', (payload) => {
    const data = getPayloadObject(payload);
    if (!data) return;
    const { from } = data;
    const room = games.get(socket.gameId);
    if (!room || !room.started) return;
    
    if (socket.playerIndex !== room.game.currentPlayer) {
      socket.emit('not-your-turn');
      return;
    }

    // If chain is active, only show continuation jumps from the active marble
    if (room.game.chainActive !== null) {
      if (from !== room.game.chainActive) {
        socket.emit('valid-moves', { from, moves: [] });
        return;
      }
      const jumps = room.game.getContinuationJumps(from);
      socket.emit('valid-moves', { from, moves: jumps.map(m => m.to) });
      return;
    }

    const allMoves = room.game.getValidMoves(from);
    socket.emit('valid-moves', { from, moves: allMoves.map(m => m.to) });
  });

  // Make a move
  socket.on('make-move', (payload) => {
    const data = getPayloadObject(payload);
    if (!data) {
      socket.emit('invalid-move', { error: 'Ungültige Anfrage' });
      return;
    }
    const { from, to } = data;
    const room = games.get(socket.gameId);
    if (!room || !room.started) return;

    if (socket.playerIndex !== room.game.currentPlayer) {
      socket.emit('not-your-turn');
      return;
    }

    room.lastActivity = Date.now(); // Issue #1: Update activity
    
    const result = room.game.makeMove(from, to);
    if (!result.valid) {
      socket.emit('invalid-move', { error: result.error });
      return;
    }

    io.to(socket.gameId).emit('move-made', {
      from,
      to,
      captures: result.captures || [],
      chainActive: result.chainActive,
      continuationMoves: result.continuationMoves || [],
      state: room.game.getState()
    });

    if (room.game.gameOver) {
      const winnerPlayer = room.players.find(p => p.index === room.game.winner);
      io.to(socket.gameId).emit('game-over', {
        winner: room.game.winner,
        winnerName: winnerPlayer ? winnerPlayer.name : PLAYER_NAMES[room.game.winner],
        state: room.game.getState()
      });
    }
  });

  // End turn (during chain jump)
  socket.on('end-turn', () => {
    const room = games.get(socket.gameId);
    if (!room || !room.started) return;

    if (socket.playerIndex !== room.game.currentPlayer) {
      socket.emit('not-your-turn');
      return;
    }

    if (room.game.chainActive === null) {
      socket.emit('error-msg', { message: 'Kein aktiver Kettensprung' });
      return;
    }

    room.lastActivity = Date.now(); // Issue #1: Update activity
    
    room.game.endTurn();
    io.to(socket.gameId).emit('turn-ended', {
      state: room.game.getState()
    });

  });

  // Reconnect to existing game
  socket.on('reconnect-game', (payload) => {
    const data = getPayloadObject(payload);
    if (!data) {
      socket.emit('reconnect-failed');
      return;
    }
    let { gameId, playerIndex, playerName, reconnectToken } = data;
    // Input validation (Issue #3)
    gameId = sanitizeString(gameId, 12, '');
    playerName = sanitizeString(playerName, 20, 'Spieler');
    playerIndex = validateNumber(playerIndex, -1, 2, -1);
    reconnectToken = sanitizeString(reconnectToken, 64, '');
    
    const room = games.get(gameId);
    if (!room || !room.started) {
      socket.emit('reconnect-failed');
      return;
    }
    
    room.lastActivity = Date.now(); // Issue #1: Update activity
    
    // Spectator reconnect
    if (playerIndex === -1 && room.spectateMode) {
      socket.join(gameId);
      socket.gameId = gameId;
      socket.playerIndex = -1;
      socket.emit('reconnected', {
        gameId,
        playerIndex: -1,
        numPlayers: room.numPlayers,
        boardLayout: getBoardLayout(),
        adjacency: ADJACENCY,
        colors: PLAYER_COLORS,
        playerNames: PLAYER_NAMES,
        actualNames: room.players.sort((a,b) => a.index - b.index).map(p => p.name),
        state: room.game.getState()
      });
      console.log(`Spectator reconnected to game ${gameId}`);
      return;
    }

    // Update the player's socket ID
    const player = room.players.find(p => p.index === playerIndex && !p.id.startsWith('ai-'));
    if (!player || !player.reconnectToken || player.reconnectToken !== reconnectToken || !player.disconnected) {
      socket.emit('reconnect-failed');
      return;
    }
    
    player.id = socket.id;
    player.name = playerName || player.name;
    player.disconnected = false;
    socket.join(gameId);
    socket.gameId = gameId;
    socket.playerIndex = playerIndex;
    
    socket.emit('reconnected', {
      gameId,
      playerIndex,
      reconnectToken: player.reconnectToken,
      numPlayers: room.numPlayers,
      boardLayout: getBoardLayout(),
      adjacency: ADJACENCY,
      colors: PLAYER_COLORS,
      playerNames: PLAYER_NAMES,
      actualNames: room.players.sort((a,b) => a.index - b.index).map(p => p.name),
      state: room.game.getState()
    });
    
    console.log(`Player ${playerIndex} reconnected to game ${gameId}`);
  });

  // Surrender
  socket.on('surrender', () => {
    const room = games.get(socket.gameId);
    if (!room || !room.started || room.game.gameOver) return;
    
    room.lastActivity = Date.now(); // Issue #1: Update activity
    
    const surrenderedPlayer = socket.playerIndex;
    const surrenderedName = room.players.find(p => p.index === surrenderedPlayer)?.name || 'Unbekannt';
    
    // Remove all marbles of surrendered player
    for (let i = 0; i < room.game.board.length; i++) {
      if (room.game.board[i] && room.game.board[i].player === surrenderedPlayer) {
        room.game.board[i] = null;
      }
    }
    
    room.game._checkGameEnd();
    
    if (!room.game.gameOver) {
      // If current player surrendered, advance turn
      if (room.game.currentPlayer === surrenderedPlayer) {
        room.game.chainActive = null;
        room.game.lastJumpedOver = null;
        room.game.currentPlayer = (room.game.currentPlayer + 1) % room.game.numPlayers;
        room.game._skipEliminatedPlayers();
      }
      room.game._checkGameEnd();
    }
    
    io.to(socket.gameId).emit('surrendered', {
      surrenderedPlayer,
      surrenderedName,
      state: room.game.getState()
    });
    
    if (room.game.gameOver) {
      const winnerPlayer = room.players.find(p => p.index === room.game.winner);
      io.to(socket.gameId).emit('game-over', {
        winner: room.game.winner,
        winnerName: winnerPlayer ? winnerPlayer.name : PLAYER_NAMES[room.game.winner],
        state: room.game.getState()
      });
    }
    
    console.log(`Player ${surrenderedPlayer} surrendered in game ${socket.gameId}`);
    // Keep player in room for rematch possibility (all game types)
  });

  // Rematch: vote to play again with rotated starting player
  socket.on('rematch', () => {
    const room = games.get(socket.gameId);
    if (!room || !room.game.gameOver) return;
    if (socket.playerIndex === null || socket.playerIndex === -1) return;

    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(socket.playerIndex);

    // Notify all players about the vote
    io.to(socket.gameId).emit('rematch-vote', {
      player: socket.playerIndex,
      playerName: room.players.find(p => p.index === socket.playerIndex)?.name || 'Spieler',
      votes: Array.from(room.rematchVotes),
      needed: room.players.filter(p => !p.id.startsWith('ai-')).length
    });

    // Check if all human players voted
    const humanPlayers = room.players.filter(p => !p.id.startsWith('ai-'));
    const allVoted = humanPlayers.every(p => room.rematchVotes.has(p.index));

    if (allVoted) {
      // Rotate starting player
      const lastStarter = room.lastStarter !== undefined ? room.lastStarter : room.game.winner || 0;
      const newStarter = (lastStarter + 1) % room.numPlayers;
      room.lastStarter = newStarter;

      // Create fresh game
      room.game = new Game(room.numPlayers, newStarter);
      room.rematchVotes = null;
      room.lastActivity = Date.now();

      io.to(socket.gameId).emit('rematch-start', {
        state: room.game.getState(),
        players: room.players.map(p => ({ name: p.name, index: p.index }))
      });

      console.log(`Rematch in game ${socket.gameId} (starter: player ${newStarter})`);
    }
  });

  // Leave game; active human players are handled like disconnects to preserve match state.
  socket.on('leave-game', () => {
    const gid = socket.gameId;
    if (!gid) return;

    const room = games.get(gid);
    if (!room) {
      socket.gameId = null;
      socket.playerIndex = null;
      return;
    }

    const player = room.players.find(p => p.id === socket.id && !p.id.startsWith('ai-'));
    if (player && !room.game.gameOver) {
      markPlayerDisconnected(socket, gid);
      socket.leave(gid);
      socket.gameId = null;
      socket.playerIndex = null;
      console.log(`Player ${player.index} left game ${gid} and was marked disconnected`);
      return;
    }

    // Issue #14: Remove spectator from room.spectators to prevent memory leak
    if (room && room.spectators) {
      const idx = room.spectators.indexOf(socket.id);
      if (idx >= 0) room.spectators.splice(idx, 1);
    }
    
    socket.leave(gid);
    socket.gameId = null;
    socket.playerIndex = null;
    console.log(`Socket ${socket.id} left game ${gid}`);
  });

  socket.on('disconnect', () => {
    if (socket.gameId) {
      markPlayerDisconnected(socket, socket.gameId);
    }
  });
});

// Auto-cleanup stale games every 5 minutes (Issue #1: Improved with lastActivity)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const GAME_TIMEOUT_MS = 30 * 60 * 1000;
const INACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
const FINISHED_GAME_TIMEOUT_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  cleanupRateLimits(createGameLimits);
  cleanupRateLimits(joinGameLimits);

  for (const [id, room] of games.entries()) {
    const age = now - (room.createdAt || 0);
    const inactiveTime = now - (room.lastActivity || room.createdAt || 0);
    
    // Delete if:
    // 1. Game is older than 30 minutes
    // 2. Game is finished and older than 5 minutes
    // 3. Game is inactive for 10 minutes
    if (age > GAME_TIMEOUT_MS || 
        (room.game.gameOver && age > FINISHED_GAME_TIMEOUT_MS) ||
        inactiveTime > INACTIVE_TIMEOUT_MS) {
      games.delete(id);
      console.log(`Cleaned up game ${id} (age: ${Math.round(age / 60000)}min, inactive: ${Math.round(inactiveTime / 60000)}min)`);
    }
  }
}, CLEANUP_INTERVAL_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Triumvirat server running on http://localhost:${PORT}`);
});
