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
const { AIPlayer } = require('./ai-player');
const { chooseMoveAsync, chooseContinuationAsync } = require('./ai-thread');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Serve shared modules for browser (isomorphic game-logic + ai-player)
app.get('/game-logic.js', (req, res) => res.sendFile(path.join(__dirname, 'game-logic.js')));
app.get('/ai-player.js', (req, res) => res.sendFile(path.join(__dirname, 'ai-player.js')));

// Active games: gameId -> { game, players: [{id, name, socketId}], spectators: [] }
const games = new Map();

// Rate limiting for game creation and joining
const createGameLimits = new Map(); // socket.id → { count, resetTime }
const joinGameLimits = new Map(); // Issue SEC-2: Rate limit join attempts
const MAX_GAMES_PER_MINUTE = 5;
const MAX_JOINS_PER_MINUTE = 20;

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

const PLAYER_COLORS = ['#e74c3c', '#2ecc71', '#3498db']; // Red, Green, Blue
const PLAYER_NAMES = ['Rot', 'Grün', 'Blau'];

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create a new game
  socket.on('create-game', ({ playerName, numPlayers, vsAI, spectate, difficulty }) => {
    // Rate limiting (Issue #13)
    const now = Date.now();
    const limit = createGameLimits.get(socket.id) || { count: 0, resetTime: now + 60000 };
    
    if (now > limit.resetTime) {
      // Reset after 1 minute
      limit.count = 0;
      limit.resetTime = now + 60000;
    }
    
    if (limit.count >= MAX_GAMES_PER_MINUTE) {
      socket.emit('error-msg', { message: 'Zu viele Spiele erstellt. Bitte warte einen Moment.' });
      return;
    }
    
    limit.count++;
    createGameLimits.set(socket.id, limit);
    
    // Input validation (Issue #3)
    playerName = sanitizeString(playerName, 20, 'Spieler');
    numPlayers = validateNumber(numPlayers, 2, 3, 3);
    difficulty = validateNumber(difficulty, 1, 5, 3);
    
    const gameId = uuidv4().substring(0, 8);
    // Security hardening: do not allow clients to create autonomous AI-only spectate games.
    // The public spectate button runs fully client-side and does not require server resources.
    const isSpectate = false;
    const effectivePlayers = numPlayers || 3;
    // Random starting player for each new game
    const startingPlayer = Math.floor(Math.random() * effectivePlayers);
    const game = new Game(effectivePlayers, startingPlayer);
    const diff = difficulty;
    
    const room = {
      game,
      numPlayers: effectivePlayers,
      players: [],
      spectators: [socket.id],
      started: false,
      vsAI: !!(vsAI || isSpectate),
      spectateMode: isSpectate,
      ai: null,
      aiPlayers: [],
      createdAt: Date.now(),
      lastActivity: Date.now(), // Issue #1: Track activity for memory leak fix
      aiExecuting: false, // Issue #2: Lock for AI execution race condition
      lastStarter: startingPlayer,
      rematchVotes: null
    };

    if (isSpectate) {
      // All players are AI
      for (let i = 0; i < effectivePlayers; i++) {
        const name = effectivePlayers > 2 ? `🤖 Mako-Bot ${i + 1}` : (i === 0 ? '🤖 Mako-Bot Rot' : '🤖 Mako-Bot Grün');
        const ai = new AIPlayer(i, name, diff);
        room.aiPlayers.push(ai);
        room.players.push({ id: `ai-${i}`, name: ai.name, index: i });
      }
      room.ai = room.aiPlayers[0];
    } else if (vsAI) {
      room.players.push({ id: socket.id, name: playerName || 'Spieler 1', index: 0 });
      const numAI = effectivePlayers - 1;
      for (let i = 0; i < numAI; i++) {
        const name = numAI > 1 ? `🤖 Mako-Bot ${i + 1}` : '🤖 Mako-Bot';
        const ai = new AIPlayer(i + 1, name, diff);
        room.aiPlayers.push(ai);
        room.players.push({ id: `ai-${i}`, name: ai.name, index: i + 1 });
      }
      room.ai = room.aiPlayers[0];
    } else {
      room.players.push({ id: socket.id, name: playerName || 'Spieler 1', index: 0 });
    }

    games.set(gameId, room);

    socket.join(gameId);
    socket.gameId = gameId;
    socket.playerIndex = isSpectate ? -1 : 0;

    socket.emit('game-created', {
      gameId,
      playerIndex: isSpectate ? -1 : 0,
      numPlayers: effectivePlayers,
      boardLayout: getBoardLayout(),
      adjacency: ADJACENCY,
      colors: PLAYER_COLORS,
      playerNames: PLAYER_NAMES,
      vsAI: !!(vsAI || isSpectate),
      spectateMode: isSpectate
    });

    // Auto-start AI and spectate games immediately
    if (vsAI || isSpectate) {
      room.started = true;
      socket.emit('game-start', {
        state: room.game.getState(),
        players: room.players.map(p => ({ name: p.name, index: p.index }))
      });
      // In spectate mode, kick off AI turns
      if (isSpectate) {
        executeAITurns(gameId);
      }
    }

    console.log(`Game ${gameId} created (${effectivePlayers} players${vsAI ? ', vs AI' : ''})`);
  });

  // Join existing game
  socket.on('join-game', ({ gameId, playerName }) => {
    // Issue SEC-2: Rate limiting for join attempts
    const now = Date.now();
    const limit = joinGameLimits.get(socket.id) || { count: 0, resetTime: now + 60000 };
    
    if (now > limit.resetTime) {
      limit.count = 0;
      limit.resetTime = now + 60000;
    }
    
    if (limit.count >= MAX_JOINS_PER_MINUTE) {
      socket.emit('error-msg', { message: 'Zu viele Join-Versuche. Bitte warte einen Moment.' });
      return;
    }
    
    limit.count++;
    joinGameLimits.set(socket.id, limit);
    
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
    room.players.push({ id: socket.id, name: playerName || `Spieler ${playerIndex + 1}`, index: playerIndex });
    room.lastActivity = Date.now(); // Issue #1: Update activity

    socket.join(gameId);
    socket.gameId = gameId;
    socket.playerIndex = playerIndex;

    socket.emit('game-joined', {
      gameId,
      playerIndex,
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
  socket.on('get-moves', ({ from }) => {
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
  socket.on('make-move', ({ from, to }) => {
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
    } else if (room.vsAI && result.chainActive === null) {
      executeAITurns(socket.gameId);
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

    // Trigger AI turn after human ends chain
    if (room.vsAI) {
      executeAITurns(socket.gameId);
    }
  });

  // Reconnect to existing game
  socket.on('reconnect-game', ({ gameId, playerIndex, playerName }) => {
    // Input validation (Issue #3)
    gameId = sanitizeString(gameId, 12, '');
    playerName = sanitizeString(playerName, 20, 'Spieler');
    playerIndex = validateNumber(playerIndex, -1, 2, -1);
    
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
    if (!player) {
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
      needed: room.vsAI ? 1 : room.players.filter(p => !p.id.startsWith('ai-')).length
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
      room.aiExecuting = false;
      room.lastActivity = Date.now();

      // Reset AI move histories
      for (const ai of room.aiPlayers) {
        ai.moveHistory = [];
        ai.bestChain = null;
      }

      io.to(socket.gameId).emit('rematch-start', {
        state: room.game.getState(),
        players: room.players.map(p => ({ name: p.name, index: p.index }))
      });

      // Trigger AI if it's AI's turn
      if (room.vsAI) {
        executeAITurns(socket.gameId);
      }

      console.log(`Rematch in game ${socket.gameId} (starter: player ${newStarter})`);
    }
  });

  // Leave game (spectator or player wanting to quit without surrender)
  socket.on('leave-game', () => {
    const gid = socket.gameId;
    if (!gid) return;
    
    // Issue #14: Remove spectator from room.spectators to prevent memory leak
    const room = games.get(gid);
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
    // Cleanup rate limiters (Issue #13, SEC-2)
    createGameLimits.delete(socket.id);
    joinGameLimits.delete(socket.id);
    
    if (socket.gameId) {
      const room = games.get(socket.gameId);
      if (room) {
        io.to(socket.gameId).emit('player-disconnected', {
          playerIndex: socket.playerIndex
        });
        // Mark player as disconnected but keep in list for reconnect
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.disconnected = true;
        // Issue #1: Improved cleanup logic
        const humanPlayers = room.players.filter(p => !p.id.startsWith('ai-'));
        const allDisconnected = humanPlayers.every(p => p.disconnected);
        const activeHumans = humanPlayers.filter(p => !p.disconnected).length;
        const age = Date.now() - (room.createdAt || 0);
        
        // Delete if: (all humans disconnected AND game over) OR (no active humans AND game older than 2min)
        if ((allDisconnected && room.game.gameOver) || (activeHumans === 0 && age > 2 * 60 * 1000)) {
          games.delete(socket.gameId);
          console.log(`Game ${socket.gameId} deleted (disconnected cleanup)`);
        }
      }
    }
  });
});

// Issue CODE-2: Structured AI error logging
function logAIError(gameId, playerIndex, error, context) {
  console.error(`[AI ERROR] Game ${gameId}, Player ${playerIndex}: ${error} (${context})`);
}

// Find the AI player for the current turn (Issue #11: Error logging)
function getActiveAI(room, gameId) {
  const currentPlayer = room.game.currentPlayer;
  const ai = room.aiPlayers.find(ai => ai.playerIndex === currentPlayer) || null;
  
  if (ai === null && room.vsAI) {
    logAIError(gameId, currentPlayer, `Expected AI but none found! aiPlayers: [${room.aiPlayers.map(a => a.playerIndex)}]`, 'getActiveAI');
  }
  
  return ai;
}

// Execute AI turns — non-blocking via Worker Threads (Issue #2: AI lock)
async function executeAITurns(gameId) {
  const room = games.get(gameId);
  if (!room || !room.vsAI || room.game.gameOver || room.aiExecuting) return;
  
  const ai = getActiveAI(room, gameId);
  if (!ai) return; // It's the human's turn

  room.aiExecuting = true; // Issue #2: Set lock
  const delay = 800 + Math.random() * 700;
  await new Promise(r => setTimeout(r, delay));

  // Check game still exists after delay
  if (!games.has(gameId)) return;
  if (room.game.gameOver) { room.aiExecuting = false; return; }

  const { move, elapsed, timedOut } = await chooseMoveAsync(room.game, ai);
  
  // Check game still exists after worker
  if (!games.has(gameId)) return;
  if (room.game.gameOver) { room.aiExecuting = false; return; }
  
  if (timedOut) console.log(`[AI] Player ${ai.playerIndex} timed out, using fallback move`);
  if (elapsed) console.log(`[AI] Player ${ai.playerIndex} computed in ${elapsed}ms`);

  if (!move) {
    logAIError(gameId, room.game.currentPlayer, 'No moves available', 'chooseMove');
    room.aiExecuting = false;
    return;
  }

  room.lastActivity = Date.now();
  
  const result = room.game.makeMove(move.from, move.to);
  if (!result.valid) {
    logAIError(gameId, ai.playerIndex, `Invalid move ${move.from}→${move.to}: ${result.error}`, 'makeMove');
    room.aiExecuting = false;
    return;
  }

  io.to(gameId).emit('move-made', {
    from: move.from,
    to: move.to,
    captures: result.captures || [],
    chainActive: result.chainActive,
    continuationMoves: result.continuationMoves || [],
    state: room.game.getState()
  });

  if (room.game.gameOver) {
    const winnerPlayer = room.players.find(p => p.index === room.game.winner);
    io.to(gameId).emit('game-over', {
      winner: room.game.winner,
      winnerName: winnerPlayer ? winnerPlayer.name : PLAYER_NAMES[room.game.winner],
      state: room.game.getState()
    });
    room.aiExecuting = false;
    return;
  }

  room.aiExecuting = false;
  
  if (result.chainActive !== null && result.chainActive !== undefined) {
    executeAIChain(gameId);
  } else {
    executeAITurns(gameId);
  }
}

async function executeAIChain(gameId) {
  const room = games.get(gameId);
  if (!room || room.game.gameOver || room.game.chainActive === null || room.aiExecuting) return;
  
  room.aiExecuting = true;
  const chainDelay = 600 + Math.random() * 500;
  await new Promise(r => setTimeout(r, chainDelay));

  if (!games.has(gameId)) return;
  if (!room || room.game.gameOver || room.game.chainActive === null) {
    room.aiExecuting = false;
    return;
  }
  const ai = getActiveAI(room, gameId);
  if (!ai) { room.aiExecuting = false; return; }

  const { move: cont } = await chooseContinuationAsync(room.game, ai);

  if (!games.has(gameId)) return;
  if (!cont) {
    room.game.endTurn();
    io.to(gameId).emit('turn-ended', { state: room.game.getState() });
    room.aiExecuting = false;
    executeAITurns(gameId);
    return;
  }

  room.lastActivity = Date.now();
  
  const result = room.game.makeMove(cont.from, cont.to);
  if (!result.valid) {
    room.game.endTurn();
    io.to(gameId).emit('turn-ended', { state: room.game.getState() });
    room.aiExecuting = false;
    executeAITurns(gameId);
    return;
  }

  io.to(gameId).emit('move-made', {
      from: cont.from,
      to: cont.to,
      captures: result.captures || [],
      chainActive: result.chainActive,
      continuationMoves: result.continuationMoves || [],
      state: room.game.getState()
    });

    if (room.game.gameOver) {
      const winnerPlayer = room.players.find(p => p.index === room.game.winner);
      io.to(gameId).emit('game-over', {
        winner: room.game.winner,
        winnerName: winnerPlayer ? winnerPlayer.name : PLAYER_NAMES[room.game.winner],
        state: room.game.getState()
      });
      room.aiExecuting = false; // Issue #2: Release lock
      return;
    }

    room.aiExecuting = false;
    
    if (result.chainActive !== null && result.chainActive !== undefined) {
      executeAIChain(gameId);
    } else {
      executeAITurns(gameId);
    }
}

// Auto-cleanup stale games every 5 minutes (Issue #1: Improved with lastActivity)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const GAME_TIMEOUT_MS = 30 * 60 * 1000;
const INACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
const FINISHED_GAME_TIMEOUT_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
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
