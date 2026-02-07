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

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71']; // Red, Blue, Green
const PLAYER_NAMES = ['Rot', 'Blau', 'Grün'];

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create a new game
  socket.on('create-game', ({ playerName, numPlayers, vsAI }) => {
    const gameId = uuidv4().substring(0, 8);
    const effectivePlayers = vsAI ? 2 : (numPlayers || 3);
    const game = new Game(effectivePlayers);
    
    const room = {
      game,
      numPlayers: effectivePlayers,
      players: [{ id: socket.id, name: playerName || 'Spieler 1', index: 0 }],
      started: false,
      vsAI: !!vsAI,
      ai: null
    };

    if (vsAI) {
      const ai = new AIPlayer(1, '🤖 Mako-Bot');
      room.ai = ai;
      room.players.push({ id: 'ai', name: ai.name, index: 1 });
    }

    games.set(gameId, room);

    socket.join(gameId);
    socket.gameId = gameId;
    socket.playerIndex = 0;

    socket.emit('game-created', {
      gameId,
      playerIndex: 0,
      numPlayers: effectivePlayers,
      boardLayout: getBoardLayout(),
      adjacency: ADJACENCY,
      colors: PLAYER_COLORS,
      playerNames: PLAYER_NAMES,
      vsAI: !!vsAI
    });

    // Auto-start AI games immediately
    if (vsAI) {
      room.started = true;
      socket.emit('game-start', {
        state: room.game.getState(),
        players: room.players.map(p => ({ name: p.name, index: p.index }))
      });
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
      executeAITurn(socket.gameId);
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
      executeAITurn(socket.gameId);
    }
  });

  socket.on('disconnect', () => {
    if (socket.gameId) {
      const room = games.get(socket.gameId);
      if (room) {
        io.to(socket.gameId).emit('player-disconnected', {
          playerIndex: socket.playerIndex
        });
        // Clean up empty games
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
          games.delete(socket.gameId);
          console.log(`Game ${socket.gameId} deleted (empty)`);
        }
      }
    }
  });
});

// AI turn execution
function executeAITurn(gameId) {
  const room = games.get(gameId);
  if (!room || !room.vsAI || !room.ai || room.game.gameOver) return;
  if (room.game.currentPlayer !== room.ai.playerIndex) return;

  const delay = 1000 + Math.random() * 1000; // 1-2 seconds

  setTimeout(() => {
    const room = games.get(gameId);
    if (!room || room.game.gameOver) return;
    if (room.game.currentPlayer !== room.ai.playerIndex) return;

    const move = room.ai.chooseMove(room.game);
    if (!move) return;

    const result = room.game.makeMove(move.from, move.to);
    if (!result.valid) return;

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

    // Handle chain jumps
    if (result.chainActive !== null && result.chainActive !== undefined) {
      executeAIChain(gameId);
    }
  }, delay);
}

function executeAIChain(gameId) {
  const chainDelay = 800 + Math.random() * 700;

  setTimeout(() => {
    const room = games.get(gameId);
    if (!room || room.game.gameOver || room.game.chainActive === null) return;
    if (room.game.currentPlayer !== room.ai.playerIndex) return;

    const cont = room.ai.chooseContinuation(room.game);
    if (!cont) {
      // End turn
      room.game.endTurn();
      io.to(gameId).emit('turn-ended', { state: room.game.getState() });
      return;
    }

    const result = room.game.makeMove(cont.from, cont.to);
    if (!result.valid) {
      room.game.endTurn();
      io.to(gameId).emit('turn-ended', { state: room.game.getState() });
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
    }
  }, chainDelay);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Triumvirat server running on http://localhost:${PORT}`);
});
