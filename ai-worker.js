/**
 * AI Worker Thread — runs Minimax computation off the main thread.
 * Receives game state + AI config, returns chosen move.
 * Hard timeout: 2 seconds.
 */

const { parentPort, workerData } = require('worker_threads');
const { Game, ADJACENCY, CORNERS, BOARD_SIZE, indexToRowCol, getJumpLanding } = require('./game-logic');
const { AIPlayer } = require('./ai-player');

const AI_TIMEOUT_MS = 2000;

parentPort.on('message', (msg) => {
  if (msg.type === 'chooseMove') {
    const { gameState, aiConfig } = msg;
    try {
      const game = reconstructGame(gameState);
      const ai = new AIPlayer(aiConfig.playerIndex, aiConfig.name, aiConfig.difficulty);
      // Copy move history for anti-repetition
      if (aiConfig.moveHistory) ai.moveHistory = aiConfig.moveHistory;

      // Run with timeout
      let result = null;
      const startTime = Date.now();
      
      // Set a flag the AI can check (for future iterative deepening)
      ai._startTime = startTime;
      ai._timeLimit = AI_TIMEOUT_MS;
      
      result = ai.chooseMove(game);
      
      const elapsed = Date.now() - startTime;
      parentPort.postMessage({ 
        type: 'moveResult', 
        move: result, 
        moveHistory: ai.moveHistory,
        plannedChain: ai._plannedChain || [],
        elapsed 
      });
    } catch (err) {
      parentPort.postMessage({ type: 'error', error: err.message });
    }
  } else if (msg.type === 'chooseContinuation') {
    const { gameState, aiConfig } = msg;
    try {
      const game = reconstructGame(gameState);
      const ai = new AIPlayer(aiConfig.playerIndex, aiConfig.name, aiConfig.difficulty);
      if (aiConfig.moveHistory) ai.moveHistory = aiConfig.moveHistory;
      if (aiConfig.plannedChain) ai._plannedChain = aiConfig.plannedChain;
      
      const result = ai.chooseContinuation(game);
      parentPort.postMessage({ 
        type: 'continuationResult', 
        move: result,
        plannedChain: ai._plannedChain || []
      });
    } catch (err) {
      parentPort.postMessage({ type: 'error', error: err.message });
    }
  }
});

// Reconstruct a Game object from serialized state
function reconstructGame(state) {
  const game = new Game(state.numPlayers);
  game.board = state.board.map(c => c ? { ...c } : null);
  game.currentPlayer = state.currentPlayer;
  game.gameOver = state.gameOver;
  game.winner = state.winner;
  game.chainActive = state.chainActive;
  game.lastJumpedOver = state.lastJumpedOver;
  game.cornerForced = state.cornerForced ? { ...state.cornerForced } : {};
  game.moveHistory = state.moveHistory || [];
  // Rebuild playerMarbles from board
  game.playerMarbles = {};
  for (let p = 0; p < state.numPlayers; p++) game.playerMarbles[p] = [];
  for (let i = 0; i < game.board.length; i++) {
    if (game.board[i]) game.playerMarbles[game.board[i].player].push(i);
  }
  return game;
}
