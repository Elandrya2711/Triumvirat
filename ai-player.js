/**
 * Triumvirat - AI Player (Medium-Hard difficulty)
 * Evaluates board positions, prefers strategic moves.
 * ~15% random moves to keep it beatable.
 */

class AIPlayer {
  constructor(playerIndex, name = '🤖 Mako-Bot') {
    this.playerIndex = playerIndex;
    this.name = name;
  }

  /**
   * Choose a move from the game state.
   * @param {Game} game
   * @returns {{ from: number, to: number } | null}
   */
  chooseMove(game) {
    const moves = game.getValidMoves();
    if (moves.length === 0) return null;

    // 15% pure random (keeps it beatable)
    if (Math.random() < 0.15) {
      return this._pick(moves);
    }

    // Score each move
    const scored = moves.map(m => ({
      move: m,
      score: this._scoreMove(m, game)
    }));

    scored.sort((a, b) => b.score - a.score);

    // Pick from top 3 with weighted randomness (best move most likely)
    const topN = scored.slice(0, Math.min(3, scored.length));
    const weights = [0.6, 0.25, 0.15];
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < topN.length; i++) {
      cumulative += weights[i] || 0.1;
      if (r <= cumulative) return topN[i].move;
    }
    return topN[0].move;
  }

  /**
   * Score a move based on strategic value
   */
  _scoreMove(move, game) {
    let score = 0;

    // Capturing is very valuable
    if (move.captures.length > 0) {
      for (const cap of move.captures) {
        // Bigger captures are worth more
        score += cap.marble.size * 30; // size 1=30, 2=60, 3=90
      }
    }

    // Jumping (even without capture) gives mobility
    if (move.isJump) {
      score += 10;
    }

    // Simulate the move and evaluate resulting position
    const simScore = this._simulateAndEvaluate(move, game);
    score += simScore;

    return score;
  }

  /**
   * Simulate a move and evaluate the resulting board position
   */
  _simulateAndEvaluate(move, game) {
    let score = 0;
    const board = game.board;
    const myPlayer = this.playerIndex;

    // Check if the destination has good continuation jumps potential
    // (without actually making the move, estimate from adjacency)
    const ADJACENCY = require('./game-logic').ADJACENCY;
    if (ADJACENCY && ADJACENCY[move.to]) {
      const neighbors = ADJACENCY[move.to];
      let threatsNearby = 0;
      let friendsNearby = 0;

      for (const adj of neighbors) {
        const cell = board[adj];
        if (!cell) continue;
        if (cell.player === myPlayer) {
          friendsNearby++;
        } else {
          threatsNearby++;
          // Can we jump over them? (potential future capture)
          score += 5;
        }
      }

      // Being near friendly marbles is good (support)
      score += friendsNearby * 3;
    }

    // Avoid moving big marbles into danger (where they could be captured)
    const marble = board[move.from];
    if (marble && ADJACENCY && ADJACENCY[move.to]) {
      for (const adj of ADJACENCY[move.to]) {
        const neighbor = board[adj];
        if (neighbor && neighbor.player !== myPlayer && neighbor.size >= marble.size) {
          score -= 20; // Danger! Could be captured
        }
      }
    }

    // Prefer center positions over edges (more mobility)
    // Positions 6-14 are roughly center of the triangle
    if (move.to >= 6 && move.to <= 14) {
      score += 8;
    }

    // Protect big marbles — don't move the size-3 marble without good reason
    if (marble && marble.size === 3 && move.captures.length === 0) {
      score -= 5; // Small penalty for moving big marble without capturing
    }

    return score;
  }

  /**
   * Choose a continuation jump or null to end turn.
   * @param {Game} game
   * @returns {{ from: number, to: number } | null} null = end turn
   */
  chooseContinuation(game) {
    const jumps = game.getContinuationJumps(game.chainActive);
    if (jumps.length === 0) return null;

    // If there's a capture available, almost always take it
    const captures = jumps.filter(m => m.captures.length > 0);
    if (captures.length > 0) {
      // 10% chance to miss a capture (human-like mistake)
      if (Math.random() < 0.1) return null;
      // Prefer bigger captures
      captures.sort((a, b) => {
        const aMax = Math.max(...a.captures.map(c => c.marble.size));
        const bMax = Math.max(...b.captures.map(c => c.marble.size));
        return bMax - aMax;
      });
      return captures[0];
    }

    // Non-capture jumps: 35% chance to stop (don't overdo chain jumps)
    if (Math.random() < 0.35) return null;

    return this._pick(jumps);
  }

  _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
}

module.exports = { AIPlayer };
