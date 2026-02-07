/**
 * Triumvirat - AI Player with Minimax + Alpha-Beta Pruning
 * Strong strategic play with ~10% imperfection for human feel.
 */

const { Game, ADJACENCY, CORNERS, BOARD_SIZE } = require('./game-logic');

// Position value: center positions have more mobility
const POS_VALUE = new Array(BOARD_SIZE).fill(0);
(() => {
  // Row 0: corner → 0, Row 1: 2, Row 2: 4, Row 3: 6 (peak), Row 4: 5, Row 5: 3 (edges lower)
  const rowVal = [0, 2, 4, 6, 5, 3];
  let idx = 0;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col <= row; col++) {
      let val = rowVal[row];
      // Edge columns worth less
      if (col === 0 || col === row) val -= 1;
      // Corners are bad
      if (CORNERS.includes(idx)) val = -5;
      POS_VALUE[idx] = val;
      idx++;
    }
  }
})();

const DIFFICULTY_SETTINGS = {
  1: { name: 'Anfänger',    randomChance: 0.40, searchDepth: 1 },
  2: { name: 'Leicht',      randomChance: 0.25, searchDepth: 2 },
  3: { name: 'Mittel',      randomChance: 0.10, searchDepth: 3 },
  4: { name: 'Schwer',      randomChance: 0.03, searchDepth: 4 },
  5: { name: 'Unbesiegbar', randomChance: 0.00, searchDepth: 5 },
};

class AIPlayer {
  constructor(playerIndex, name = '🤖 Mako-Bot', difficulty = 3) {
    this.playerIndex = playerIndex;
    this.name = name;
    this.difficulty = Math.max(1, Math.min(5, difficulty));
    const settings = DIFFICULTY_SETTINGS[this.difficulty];
    this.randomChance = settings.randomChance;
    this.maxDepth = settings.searchDepth;
  }

  chooseMove(game) {
    const moves = game.getValidMoves();
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    // Expand each move into full sequences (including chain jumps)
    const sequences = [];
    for (const move of moves) {
      if (move.isJump) {
        // Explore all possible chain continuations
        const chains = this._expandChains(game, move);
        for (const chain of chains) {
          sequences.push(chain);
        }
      } else {
        sequences.push([move]);
      }
    }

    // Score each sequence with minimax
    let best = -Infinity;
    let bestSeqs = [];
    let secondBest = -Infinity;
    let secondSeqs = [];

    for (const seq of sequences) {
      const simGame = this._cloneGame(game);
      this._applySequence(simGame, seq);
      // After our move, it's opponent's turn — minimax from opponent perspective
      const score = this._minimax(simGame, this.maxDepth - 1, -Infinity, Infinity, false);

      if (score > best) {
        secondBest = best;
        secondSeqs = bestSeqs;
        best = score;
        bestSeqs = [seq];
      } else if (score === best) {
        bestSeqs.push(seq);
      } else if (score > secondBest) {
        secondBest = score;
        secondSeqs = [seq];
      } else if (score === secondBest) {
        secondSeqs.push(seq);
      }
    }

    // Imperfection based on difficulty
    let chosen;
    if (Math.random() < this.randomChance && secondSeqs.length > 0 && secondBest > -Infinity) {
      chosen = secondSeqs[Math.floor(Math.random() * secondSeqs.length)];
    } else {
      chosen = bestSeqs[Math.floor(Math.random() * bestSeqs.length)];
    }

    // Store the full chain plan for continuation
    this._plannedChain = chosen.slice(1);
    return chosen[0];
  }

  chooseContinuation(game) {
    // If we have a pre-planned chain, use it
    if (this._plannedChain && this._plannedChain.length > 0) {
      const next = this._plannedChain.shift();
      // Verify it's still valid
      const jumps = game.getContinuationJumps(game.chainActive);
      if (jumps.find(m => m.from === next.from && m.to === next.to)) {
        return next;
      }
      this._plannedChain = [];
    }

    // Fallback: evaluate continuations with minimax
    const jumps = game.getContinuationJumps(game.chainActive);
    if (jumps.length === 0) return null;

    // Compare stopping vs each continuation
    const stopGame = this._cloneGame(game);
    stopGame.endTurn();
    const stopScore = this._minimax(stopGame, 2, -Infinity, Infinity, false);

    let bestScore = stopScore;
    let bestMove = null;

    for (const jump of jumps) {
      const simGame = this._cloneGame(game);
      simGame.makeMove(jump.from, jump.to);
      // If chain continues, evaluate stopping there
      const sg = this._cloneGame(simGame);
      if (sg.chainActive !== null) sg.endTurn();
      const score = this._minimax(sg, 2, -Infinity, Infinity, false);
      if (score > bestScore) {
        bestScore = score;
        bestMove = jump;
      }
    }

    return bestMove; // null means stop (end turn)
  }

  // Expand a jump move into all possible chain sequences
  _expandChains(game, initialMove) {
    const results = [];
    const simGame = this._cloneGame(game);
    simGame.makeMove(initialMove.from, initialMove.to);

    if (simGame.chainActive === null) {
      results.push([initialMove]);
      return results;
    }

    // BFS/DFS to find all chain paths (limit depth to prevent explosion)
    const stack = [{ game: this._cloneGame(simGame), path: [initialMove], depth: 0 }];
    while (stack.length > 0) {
      const { game: g, path, depth } = stack.pop();
      if (depth > 5) { results.push(path); continue; }

      const jumps = g.getContinuationJumps(g.chainActive);
      // Option: stop here
      results.push(path);

      for (const jump of jumps) {
        const ng = this._cloneGame(g);
        ng.makeMove(jump.from, jump.to);
        const newPath = [...path, jump];
        if (ng.chainActive !== null) {
          stack.push({ game: ng, path: newPath, depth: depth + 1 });
        } else {
          results.push(newPath);
        }
      }
    }

    return results.length > 0 ? results : [[initialMove]];
  }

  _applySequence(game, seq) {
    for (const move of seq) {
      game.makeMove(move.from, move.to);
    }
    if (game.chainActive !== null) game.endTurn();
  }

  _minimax(game, depth, alpha, beta, isMaximizing) {
    if (depth === 0 || game.gameOver) {
      return this._evaluate(game);
    }

    const moves = game.getValidMoves();
    if (moves.length === 0) {
      // No moves — skip turn
      const ng = this._cloneGame(game);
      ng.currentPlayer = (ng.currentPlayer + 1) % ng.numPlayers;
      return this._minimax(ng, depth - 1, alpha, beta, !isMaximizing);
    }

    // Group moves into full sequences (with chains) but limit for performance
    const sequences = [];
    for (const move of moves) {
      if (move.isJump) {
        // At deeper levels, just take greedy best chain
        const simGame = this._cloneGame(game);
        simGame.makeMove(move.from, move.to);
        const chain = [move];
        // Greedily follow best chain (capture > non-capture)
        let cg = simGame;
        let chainDepth = 0;
        while (cg.chainActive !== null && chainDepth < 4) {
          const cjumps = cg.getContinuationJumps(cg.chainActive);
          if (cjumps.length === 0) break;
          const captures = cjumps.filter(m => m.captures.length > 0);
          const best = captures.length > 0 ? captures[0] : cjumps[0];
          cg.makeMove(best.from, best.to);
          chain.push(best);
          chainDepth++;
        }
        if (cg.chainActive !== null) cg.endTurn();
        sequences.push({ seq: chain, endGame: cg });
      } else {
        const simGame = this._cloneGame(game);
        simGame.makeMove(move.from, move.to);
        sequences.push({ seq: [move], endGame: simGame });
      }
    }

    if (isMaximizing) {
      let maxEval = -Infinity;
      for (const { endGame } of sequences) {
        const ev = this._minimax(endGame, depth - 1, alpha, beta, false);
        maxEval = Math.max(maxEval, ev);
        alpha = Math.max(alpha, ev);
        if (beta <= alpha) break;
      }
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const { endGame } of sequences) {
        const ev = this._minimax(endGame, depth - 1, alpha, beta, true);
        minEval = Math.min(minEval, ev);
        beta = Math.min(beta, ev);
        if (beta <= alpha) break;
      }
      return minEval;
    }
  }

  _evaluate(game) {
    const me = this.playerIndex;
    let score = 0;
    const board = game.board;

    // Material + position
    for (let i = 0; i < BOARD_SIZE; i++) {
      const cell = board[i];
      if (!cell) continue;
      const materialVal = cell.size === 3 ? 30 : cell.size === 2 ? 20 : 10;
      const posVal = POS_VALUE[i];

      if (cell.player === me) {
        score += materialVal + posVal;
        // Threat detection: can opponents capture this?
        score -= this._threatPenalty(board, i, cell);
      } else {
        score -= materialVal + posVal;
        // Bonus if we threaten enemy pieces
        score += this._threatBonus(board, i, cell, me);
      }
    }

    // Mobility bonus for maximizing player
    if (game.currentPlayer === me && !game.gameOver) {
      const moves = game.getValidMoves();
      score += moves.length * 1.5;
    }

    // Game over bonus
    if (game.gameOver) {
      if (game.winner === me) score += 500;
      else score -= 500;
    }

    return score;
  }

  _threatPenalty(board, pos, marble) {
    let penalty = 0;
    for (const adj of ADJACENCY[pos]) {
      const neighbor = board[adj];
      if (!neighbor || neighbor.player === marble.player) continue;
      if (neighbor.size >= marble.size) {
        // Check if they can actually jump us (landing must be empty)
        const landing = this._getJumpLanding(adj, pos);
        if (landing >= 0 && landing < BOARD_SIZE && !board[landing]) {
          // Threatened! Penalty proportional to our marble value
          penalty += marble.size === 3 ? 15 : marble.size === 2 ? 8 : 3;
        }
      }
    }
    return penalty;
  }

  _threatBonus(board, pos, enemyMarble, me) {
    let bonus = 0;
    for (const adj of ADJACENCY[pos]) {
      const neighbor = board[adj];
      if (!neighbor || neighbor.player !== me) continue;
      if (neighbor.size >= enemyMarble.size) {
        const landing = this._getJumpLanding(adj, pos);
        if (landing >= 0 && landing < BOARD_SIZE && !board[landing]) {
          bonus += enemyMarble.size === 3 ? 8 : enemyMarble.size === 2 ? 4 : 2;
        }
      }
    }
    return bonus;
  }

  _getJumpLanding(from, over) {
    const f = this._indexToRowCol(from);
    const o = this._indexToRowCol(over);
    const dr = o.row - f.row;
    const dc = o.col - f.col;
    const nr = o.row + dr;
    const nc = o.col + dc;
    if (nr < 0 || nr >= 6 || nc < 0 || nc > nr) return -1;
    return (nr * (nr + 1)) / 2 + nc;
  }

  _indexToRowCol(idx) {
    let count = 0;
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col <= row; col++) {
        if (count === idx) return { row, col };
        count++;
      }
    }
    return { row: 0, col: 0 };
  }

  _cloneGame(game) {
    const ng = Object.create(Game.prototype);
    ng.numPlayers = game.numPlayers;
    ng.board = game.board.map(c => c ? { ...c } : null);
    ng.currentPlayer = game.currentPlayer;
    ng.gameOver = game.gameOver;
    ng.winner = game.winner;
    ng.moveHistory = []; // Don't need history for simulation
    ng.chainActive = game.chainActive;
    ng.lastJumpedOver = game.lastJumpedOver;
    return ng;
  }

  _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
}

module.exports = { AIPlayer };
