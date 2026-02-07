/**
 * Triumvirat - AI Player (Medium difficulty)
 * 70% best move, 30% random. Chain jumps with 20% early stop chance.
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

    // 70% best, 30% random
    if (Math.random() < 0.3) {
      return this._pick(moves);
    }

    // Prioritize: captures > jumps > normal
    const captures = moves.filter(m => m.captures.length > 0);
    if (captures.length > 0) {
      // Prefer capturing larger marbles
      captures.sort((a, b) => {
        const aMax = Math.max(...a.captures.map(c => c.marble.size));
        const bMax = Math.max(...b.captures.map(c => c.marble.size));
        return bMax - aMax;
      });
      return captures[0];
    }

    const jumps = moves.filter(m => m.isJump);
    if (jumps.length > 0) return this._pick(jumps);

    return this._pick(moves);
  }

  /**
   * Choose a continuation jump or null to end turn.
   * @param {Game} game
   * @returns {{ from: number, to: number } | null} null = end turn
   */
  chooseContinuation(game) {
    // 20% chance to stop early
    if (Math.random() < 0.2) return null;

    const jumps = game.getContinuationJumps(game.chainActive);
    if (jumps.length === 0) return null;

    // Prefer captures
    const captures = jumps.filter(m => m.captures.length > 0);
    if (captures.length > 0) {
      return Math.random() < 0.3 ? this._pick(captures) : captures[0];
    }

    return this._pick(jumps);
  }

  _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
}

module.exports = { AIPlayer };
