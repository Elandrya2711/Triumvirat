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

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Active games: gameId -> { game, players: [{id, name, socketId}], spectators: [] }
const games = new Map();

const PLAYER_COLORS = ['#e74c3c', '#2ecc71', '#3498db']; // Red, Green, Blue
const PLAYER_NAMES = ['Rot', 'Grün', 'Blau'];

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create a new game
  socket.on('create-game', ({ playerName, numPlayers, vsAI, spectate, difficulty }) => {
    const gameId = uuidv4().substring(0, 8);
    const isSpectate = !!spectate;
    const effectivePlayers = isSpectate ? 3 : (vsAI ? (numPlayers || 2) : (numPlayers || 3));
    const game = new Game(effectivePlayers);
    const diff = Math.max(1, Math.min(5, difficulty || 3));
    
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
      createdAt: Date.now()
    };

    if (isSpectate) {
      // All 3 players are AI
      for (let i = 0; i < 3; i++) {
        const name = `🤖 Mako-Bot ${i + 1}`;
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
    const room = games.get(gameId);
    if (!room || !room.started) {
      socket.emit('reconnect-failed');
      return;
    }
    
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
  });

  socket.on('disconnect', () => {
    if (socket.gameId) {
      const room = games.get(socket.gameId);
      if (room) {
        io.to(socket.gameId).emit('player-disconnected', {
          playerIndex: socket.playerIndex
        });
        // Mark player as disconnected but keep in list for reconnect
        const player = room.players.find(p => p.id === socket.id);
        if (player) player.disconnected = true;
        // Only delete game if ALL human players are disconnected and game is over
        const humanPlayers = room.players.filter(p => !p.id.startsWith('ai-'));
        const allDisconnected = humanPlayers.every(p => p.disconnected);
        if (allDisconnected && room.game.gameOver) {
          games.delete(socket.gameId);
          console.log(`Game ${socket.gameId} deleted (all disconnected + game over)`);
        }
      }
    }
  });
});

// Find the AI player for the current turn
function getActiveAI(room) {
  const currentPlayer = room.game.currentPlayer;
  const ai = room.aiPlayers.find(ai => ai.playerIndex === currentPlayer) || null;
  console.log(`getActiveAI: currentPlayer=${currentPlayer}, aiPlayers=[${room.aiPlayers.map(a=>a.playerIndex)}], found=${!!ai}`);
  return ai;
}

// Execute AI turns - will chain through multiple AIs if needed
function executeAITurns(gameId) {
  const room = games.get(gameId);
  if (!room || !room.vsAI || room.game.gameOver) return;
  
  const ai = getActiveAI(room);
  if (!ai) return; // It's the human's turn

  const delay = 1000 + Math.random() * 1000;

  setTimeout(() => {
    const room = games.get(gameId);
    if (!room || room.game.gameOver) return;
    const ai = getActiveAI(room);
    if (!ai) return;

    let move;
    try {
      move = ai.chooseMove(room.game);
    } catch (err) {
      console.error('AI chooseMove error:', err.message);
      // Fallback: pick random valid move
      const fallbackMoves = room.game.getValidMoves();
      move = fallbackMoves.length > 0 ? fallbackMoves[0] : null;
    }
    if (!move) {
      console.error('AI has no moves! Player:', room.game.currentPlayer);
      return;
    }

    const result = room.game.makeMove(move.from, move.to);
    if (!result.valid) {
      console.error('AI made invalid move:', move, result.error);
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
      return;
    }

    if (result.chainActive !== null && result.chainActive !== undefined) {
      executeAIChain(gameId);
    } else {
      // After this AI's turn, check if next player is also an AI
      executeAITurns(gameId);
    }
  }, delay);
}

function executeAIChain(gameId) {
  const chainDelay = 800 + Math.random() * 700;

  setTimeout(() => {
    const room = games.get(gameId);
    if (!room || room.game.gameOver || room.game.chainActive === null) return;
    const ai = getActiveAI(room);
    if (!ai) return;

    let cont;
    try {
      cont = ai.chooseContinuation(room.game);
    } catch (err) {
      console.error('AI chooseContinuation error:', err.message);
      cont = null;
    }
    if (!cont) {
      room.game.endTurn();
      io.to(gameId).emit('turn-ended', { state: room.game.getState() });
      // After ending chain, check if next player is also AI
      executeAITurns(gameId);
      return;
    }

    const result = room.game.makeMove(cont.from, cont.to);
    if (!result.valid) {
      room.game.endTurn();
      io.to(gameId).emit('turn-ended', { state: room.game.getState() });
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
      return;
    }

    if (result.chainActive !== null && result.chainActive !== undefined) {
      executeAIChain(gameId);
    } else {
      executeAITurns(gameId);
    }
  }, chainDelay);
}

// Auto-cleanup stale games every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of games.entries()) {
    const age = now - (room.createdAt || 0);
    // Remove games older than 30 minutes, or finished games older than 5 minutes
    if (age > 30 * 60 * 1000 || (room.game.gameOver && age > 5 * 60 * 1000)) {
      games.delete(id);
      console.log(`Cleaned up stale game ${id} (age: ${Math.round(age / 60000)}min)`);
    }
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Triumvirat server running on http://localhost:${PORT}`);
});
