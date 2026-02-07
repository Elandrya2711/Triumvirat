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
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Active games: gameId -> { game, players: [{id, name, socketId}], spectators: [] }
const games = new Map();

const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71']; // Red, Blue, Green
const PLAYER_NAMES = ['Rot', 'Blau', 'Grün'];

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create a new game
  socket.on('create-game', ({ playerName, numPlayers }) => {
    const gameId = uuidv4().substring(0, 8);
    const game = new Game(numPlayers || 3);
    
    games.set(gameId, {
      game,
      numPlayers: numPlayers || 3,
      players: [{ id: socket.id, name: playerName || 'Spieler 1', index: 0 }],
      started: false
    });

    socket.join(gameId);
    socket.gameId = gameId;
    socket.playerIndex = 0;

    socket.emit('game-created', {
      gameId,
      playerIndex: 0,
      numPlayers: numPlayers || 3,
      boardLayout: getBoardLayout(),
      adjacency: ADJACENCY,
      colors: PLAYER_COLORS,
      playerNames: PLAYER_NAMES
    });

    console.log(`Game ${gameId} created (${numPlayers} players)`);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Triumvirat server running on http://localhost:${PORT}`);
});
