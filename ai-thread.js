/**
 * AI Thread Manager — wraps Worker Threads for non-blocking AI.
 * Each AI computation runs in a separate thread with a 2s hard timeout.
 */

const { Worker } = require('worker_threads');
const path = require('path');

const WORKER_PATH = path.join(__dirname, 'ai-worker.js');
const AI_TIMEOUT_MS = 2000;

// Serialize game state for transfer to worker
function serializeGame(game) {
  return {
    board: game.board.map(c => c ? { ...c } : null),
    currentPlayer: game.currentPlayer,
    numPlayers: game.numPlayers,
    gameOver: game.gameOver,
    winner: game.winner,
    chainActive: game.chainActive,
    lastJumpedOver: game.lastJumpedOver,
    cornerForced: game.cornerForced ? { ...game.cornerForced } : {},
    moveHistory: game.moveHistory || []
  };
}

/**
 * Run AI move selection in a worker thread.
 * Returns: { move, moveHistory, plannedChain, elapsed } or null on timeout/error.
 */
function chooseMoveAsync(game, ai) {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate();
        console.log(`[AI Thread] Timeout after ${AI_TIMEOUT_MS}ms for player ${ai.playerIndex}`);
        // Fallback: pick first valid move
        const moves = game.getValidMoves();
        const fallbackMove = moves.length > 0 ? moves[0] : null;
        if (fallbackMove) {
          ai.moveHistory.push(`${fallbackMove.from}-${fallbackMove.to}`);
          if (ai.moveHistory.length > 12) ai.moveHistory.shift();
        }
        resolve({
          move: fallbackMove,
          moveHistory: ai.moveHistory,
          plannedChain: [],
          elapsed: AI_TIMEOUT_MS,
          timedOut: true
        });
      }
    }, AI_TIMEOUT_MS);

    worker.on('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      
      if (msg.type === 'moveResult') {
        // Sync move history back to AI instance
        ai.moveHistory = msg.moveHistory || ai.moveHistory;
        ai._plannedChain = msg.plannedChain || [];
        resolve({ 
          move: msg.move, 
          moveHistory: msg.moveHistory,
          plannedChain: msg.plannedChain,
          elapsed: msg.elapsed,
          timedOut: false
        });
      } else if (msg.type === 'error') {
        console.error(`[AI Thread] Error: ${msg.error}`);
        const moves = game.getValidMoves();
        resolve({ move: moves.length > 0 ? moves[0] : null, timedOut: false });
      }
    });

    worker.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      console.error(`[AI Thread] Worker error: ${err.message}`);
      const moves = game.getValidMoves();
      resolve({ move: moves.length > 0 ? moves[0] : null, timedOut: false });
    });

    worker.postMessage({
      type: 'chooseMove',
      gameState: serializeGame(game),
      aiConfig: {
        playerIndex: ai.playerIndex,
        name: ai.name,
        difficulty: ai.difficulty,
        moveHistory: ai.moveHistory
      }
    });
  });
}

/**
 * Run AI continuation selection in a worker thread.
 */
function chooseContinuationAsync(game, ai) {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_PATH);
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate();
        resolve({ move: null, plannedChain: [] }); // End chain on timeout
      }
    }, AI_TIMEOUT_MS);

    worker.on('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      
      if (msg.type === 'continuationResult') {
        ai._plannedChain = msg.plannedChain || [];
        resolve({ move: msg.move, plannedChain: msg.plannedChain });
      } else {
        resolve({ move: null, plannedChain: [] });
      }
    });

    worker.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ move: null, plannedChain: [] });
    });

    worker.postMessage({
      type: 'chooseContinuation',
      gameState: serializeGame(game),
      aiConfig: {
        playerIndex: ai.playerIndex,
        name: ai.name,
        difficulty: ai.difficulty,
        moveHistory: ai.moveHistory,
        plannedChain: ai._plannedChain || []
      }
    });
  });
}

module.exports = { chooseMoveAsync, chooseContinuationAsync };
