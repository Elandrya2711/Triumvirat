/**
 * AI Web Worker — runs Minimax in browser thread.
 * Loads game-logic.js and ai-player.js as isomorphic modules.
 */

importScripts('/game-logic.js', '/ai-player.js');

const AI_TIMEOUT_MS = 2000;

let aiInstance = null;

onmessage = (e) => {
  const { type, gameState, aiConfig } = e.data;
  
  if (type === 'chooseMove') {
    try {
      const game = reconstructGame(gameState);
      if (!aiInstance || aiInstance.playerIndex !== aiConfig.playerIndex || aiInstance.difficulty !== aiConfig.difficulty) {
        aiInstance = new AIPlayer(aiConfig.playerIndex, aiConfig.name, aiConfig.difficulty);
      }
      if (aiConfig.moveHistory) aiInstance.moveHistory = aiConfig.moveHistory;
      
      const start = Date.now();
      const move = aiInstance.chooseMove(game);
      const elapsed = Date.now() - start;
      
      postMessage({ 
        type: 'moveResult', 
        move, 
        moveHistory: aiInstance.moveHistory,
        plannedChain: aiInstance._plannedChain || [],
        elapsed 
      });
    } catch (err) {
      postMessage({ type: 'error', error: err.message });
    }
  } else if (type === 'chooseContinuation') {
    try {
      const game = reconstructGame(gameState);
      if (!aiInstance) {
        aiInstance = new AIPlayer(aiConfig.playerIndex, aiConfig.name, aiConfig.difficulty);
      }
      if (aiConfig.plannedChain) aiInstance._plannedChain = aiConfig.plannedChain;
      
      const move = aiInstance.chooseContinuation(game);
      postMessage({ 
        type: 'continuationResult', 
        move,
        plannedChain: aiInstance._plannedChain || []
      });
    } catch (err) {
      postMessage({ type: 'error', error: err.message });
    }
  }
};

function reconstructGame(state) {
  const { Game } = self.GameLogic;
  const game = new Game(state.numPlayers);
  game.board = state.board.map(c => c ? { ...c } : null);
  game.currentPlayer = state.currentPlayer;
  game.gameOver = state.gameOver;
  game.winner = state.winner;
  game.chainActive = state.chainActive;
  game.lastJumpedOver = state.lastJumpedOver;
  game.cornerForced = state.cornerForced ? { ...state.cornerForced } : {};
  game.moveHistory = state.moveHistory || [];
  game.playerMarbles = {};
  for (let p = 0; p < state.numPlayers; p++) game.playerMarbles[p] = [];
  for (let i = 0; i < game.board.length; i++) {
    if (game.board[i]) game.playerMarbles[game.board[i].player].push(i);
  }
  return game;
}
