/**
 * Triumvirat - Game Logic (Server-authoritative)
 * 
 * Triangular board with side length 7 = 28 positions.
 * Each player has 6 marbles (1 large=3, 2 medium=2, 3 small=1) in a corner.
 * 
 * Board layout (indices):
 *           0
 *          1  2
 *         3  4  5
 *        6  7  8  9
 *      10 11 12 13 14
 *     15 16 17 18 19 20
 *    21 22 23 24 25 26 27
 *
 * Corner A (top) = 0, Corner B (bottom-left) = 21, Corner C (bottom-right) = 27
 * 
 * Player A zone: 0(large), 1,2(medium), 3,4,5(small)
 * Player B zone: 21(large), 15,22(medium), 10,16,23(small)  
 * Player C zone: 27(large), 20,26(medium), 14,19,25(small)
 */

const BOARD_SIZE = 28;
const NUM_ROWS = 7;

const CORNER_A = 0;
const CORNER_B = 21;
const CORNER_C = 27;
const CORNERS = [CORNER_A, CORNER_B, CORNER_C];

function indexToRowCol(idx) {
  let count = 0;
  for (let row = 0; row < NUM_ROWS; row++) {
    for (let col = 0; col <= row; col++) {
      if (count === idx) return { row, col };
      count++;
    }
  }
  return null;
}

function rowColToIndex(row, col) {
  if (row < 0 || row >= NUM_ROWS || col < 0 || col > row) return -1;
  return (row * (row + 1)) / 2 + col;
}

function getAdjacent(idx) {
  const { row, col } = indexToRowCol(idx);
  const neighbors = [];
  const deltas = [
    [0, -1], [0, 1],
    [-1, -1], [-1, 0],
    [1, 0], [1, 1]
  ];
  for (const [dr, dc] of deltas) {
    const ni = rowColToIndex(row + dr, col + dc);
    if (ni >= 0) neighbors.push(ni);
  }
  return neighbors;
}

function getJumpLanding(from, over) {
  const f = indexToRowCol(from);
  const o = indexToRowCol(over);
  const dr = o.row - f.row;
  const dc = o.col - f.col;
  return rowColToIndex(o.row + dr, o.col + dc);
}

const ADJACENCY = [];
for (let i = 0; i < BOARD_SIZE; i++) {
  ADJACENCY[i] = getAdjacent(i);
}

function getStartPositions(corner) {
  if (corner === CORNER_A) {
    // Top corner: row0=large, row1=medium, row2=small
    return [
      { pos: 0, size: 3 },
      { pos: 1, size: 2 }, { pos: 2, size: 2 },
      { pos: 3, size: 1 }, { pos: 4, size: 1 }, { pos: 5, size: 1 }
    ];
  } else if (corner === CORNER_B) {
    // Bottom-left corner (pos 21): large=21, medium=15,22, small=10,16,23
    return [
      { pos: 21, size: 3 },
      { pos: 15, size: 2 }, { pos: 22, size: 2 },
      { pos: 10, size: 1 }, { pos: 16, size: 1 }, { pos: 23, size: 1 }
    ];
  } else {
    // Bottom-right corner (pos 27): large=27, medium=20,26, small=14,19,25
    return [
      { pos: 27, size: 3 },
      { pos: 20, size: 2 }, { pos: 26, size: 2 },
      { pos: 14, size: 1 }, { pos: 19, size: 1 }, { pos: 25, size: 1 }
    ];
  }
}

class Game {
  constructor(numPlayers = 3) {
    this.numPlayers = numPlayers;
    this.board = new Array(BOARD_SIZE).fill(null);
    this.currentPlayer = 0;
    this.gameOver = false;
    this.winner = null;
    this.moveHistory = [];
    this.chainActive = null;
    this.lastJumpedOver = null;  // Track last jumped-over position to prevent back-and-forth
    this.cornerForced = {};  // Per-player: { [playerIndex]: position } — marble forced to leave corner next turn
    this.playerMarbles = {}; // Issue #9: Track marble positions per player for performance
    this._setupBoard();
  }

  _setupBoard() {
    const corners = [CORNER_A, CORNER_B, CORNER_C];
    
    // Issue #9: Initialize playerMarbles tracking
    for (let p = 0; p < this.numPlayers; p++) {
      this.playerMarbles[p] = [];
    }
    
    for (let p = 0; p < this.numPlayers; p++) {
      for (const { pos, size } of getStartPositions(corners[p])) {
        this.board[pos] = { player: p, size };
        this.playerMarbles[p].push(pos); // Issue #9: Track position
      }
    }
  }

  getState() {
    return {
      board: this.board.map(c => c ? { ...c } : null),
      currentPlayer: this.currentPlayer,
      numPlayers: this.numPlayers,
      gameOver: this.gameOver,
      winner: this.winner,
      chainActive: this.chainActive,
      marbleCount: this._getMarbleCounts()
    };
  }

  _getMarbleCounts() {
    const counts = new Array(this.numPlayers).fill(0);
    for (const cell of this.board) {
      if (cell) counts[cell.player]++;
    }
    return counts;
  }

  getValidMoves(forPos) {
    const moves = [];
    const player = this.currentPlayer;

    // If this player has a marble forced out of a corner, it must move first
    const forcedCornerMarble = this.cornerForced[player] !== undefined ? this.cornerForced[player] : null;

    // Issue #9: Only iterate over current player's marbles instead of entire board
    const positions = forPos !== undefined 
      ? [forPos] 
      : (this.playerMarbles[player] || []);

    for (const i of positions) {
      const cell = this.board[i];
      if (!cell || cell.player !== player) continue;
      // If a marble is forced out of corner, only allow moves for that marble
      if (forcedCornerMarble !== null && i !== forcedCornerMarble) continue;

      // Simple moves to adjacent empty non-corner fields
      for (const adj of ADJACENCY[i]) {
        if (!this.board[adj] && !CORNERS.includes(adj)) {
          moves.push({ from: i, to: adj, captures: [], isJump: false });
        }
      }

      // Single jump moves only (no chaining)
      this._findSingleJumps(i, cell, moves);
    }

    return moves;
  }

  _findSingleJumps(from, marble, results) {
    for (const adj of ADJACENCY[from]) {
      const target = this.board[adj];
      if (!target) continue;
      if (target.size > marble.size) continue;

      const landing = getJumpLanding(from, adj);
      if (landing < 0 || landing >= BOARD_SIZE) continue;
      if (this.board[landing] && landing !== from) continue;

      const captures = [];
      if (target.player !== marble.player) {
        captures.push({ pos: adj, marble: { ...target } });
      }

      // Corners allowed as jump landing (but must be vacated next turn)
      results.push({ from, to: landing, captures, isJump: true });
    }
  }

  getContinuationJumps(pos) {
    const marble = this.board[pos];
    if (!marble) return [];
    const results = [];
    this._findSingleJumps(pos, marble, results);
    // All jumps allowed in chain, but not back over the last jumped-over marble
    if (this.lastJumpedOver !== null) {
      return results.filter(m => {
        const adj = this._getJumpedPosition(pos, m.to);
        return adj !== this.lastJumpedOver;
      });
    }
    return results;
  }

  _getJumpedPosition(from, to) {
    for (const adj of ADJACENCY[from]) {
      if (getJumpLanding(from, adj) === to) return adj;
    }
    return null;
  }

  makeMove(from, to) {
    if (this.gameOver) return { valid: false, error: 'Spiel ist vorbei' };

    // If chain is active, only allow moves from the chain position
    if (this.chainActive !== null && this.chainActive !== undefined) {
      if (from !== this.chainActive) {
        return { valid: false, error: 'Du musst mit der aktiven Kugel weiterspringen oder den Zug beenden' };
      }
      const jumps = this.getContinuationJumps(from);
      const move = jumps.find(m => m.to === to);
      if (!move) return { valid: false, error: 'Ungültiger Sprung' };

      const marble = { ...this.board[from] };
      this.board[from] = null;
      this.board[to] = marble;
      for (const cap of move.captures) {
        this.board[cap.pos] = null;
      }
      this.lastJumpedOver = this._getJumpedPosition(from, to);
      this.moveHistory.push({ from, to, captures: move.captures, player: this.currentPlayer });
      this._checkGameEnd();

      if (!this.gameOver) {
        const nextJumps = this.getContinuationJumps(to);
        if (nextJumps.length > 0) {
          this.chainActive = to;
          return { valid: true, captures: move.captures, chainActive: to, continuationMoves: nextJumps.map(m => m.to) };
        } else {
          this.chainActive = null;
          this.lastJumpedOver = null;
          this._advanceTurn(to);
          return { valid: true, captures: move.captures, chainActive: null };
        }
      }
      return { valid: true, captures: move.captures, chainActive: null };
    }

    const validMoves = this.getValidMoves();
    const move = validMoves.find(m => m.from === from && m.to === to);

    if (!move) return { valid: false, error: 'Ungültiger Zug' };

    const marble = { ...this.board[from] };
    this.board[from] = null;
    this.board[to] = marble;

    // Issue #9: Update playerMarbles tracking when moving
    const player = marble.player;
    const idx = this.playerMarbles[player].indexOf(from);
    if (idx >= 0) {
      this.playerMarbles[player][idx] = to;
    }

    // Issue #9: Remove captured marbles from tracking
    for (const cap of move.captures) {
      this.board[cap.pos] = null;
      const capPlayer = cap.marble.player;
      const capIdx = this.playerMarbles[capPlayer].indexOf(cap.pos);
      if (capIdx >= 0) {
        this.playerMarbles[capPlayer].splice(capIdx, 1);
      }
    }

    // Issue #10: Explicit clear for non-jump moves
    if (move.isJump) {
      this.lastJumpedOver = this._getJumpedPosition(from, to);
    } else {
      this.lastJumpedOver = null;
    }

    this.moveHistory.push({ from, to, captures: move.captures, player: this.currentPlayer });

    this._checkGameEnd();

    if (!this.gameOver) {
      // If it was a jump (over own or enemy), check for continuation jumps
      if (move.isJump) {
        const nextJumps = this.getContinuationJumps(to);
        if (nextJumps.length > 0) {
          this.chainActive = to;
          return { valid: true, captures: move.captures, chainActive: to, continuationMoves: nextJumps.map(m => m.to) };
        }
      }
      this.chainActive = null;
      this.lastJumpedOver = null;
      this._advanceTurn(to);
    }

    return { valid: true, captures: move.captures, chainActive: null };
  }

  _advanceTurn(lastTo) {
    // If current player's marble ended in a corner, they must move it out on their next turn
    if (CORNERS.includes(lastTo)) {
      this.cornerForced[this.currentPlayer] = lastTo;
    } else {
      delete this.cornerForced[this.currentPlayer];
    }
    this.currentPlayer = (this.currentPlayer + 1) % this.numPlayers;
    this._skipEliminatedPlayers();
  }

  _skipEliminatedPlayers() {
    // Issue #5: Fix potential infinite loop
    const counts = this._getMarbleCounts();
    let attempts = 0;
    while (counts[this.currentPlayer] === 0 && attempts < this.numPlayers) {
      this.currentPlayer = (this.currentPlayer + 1) % this.numPlayers;
      attempts++;
    }
    // If still 0 after checking all players, game should be over
    if (counts[this.currentPlayer] === 0) {
      this.gameOver = true;
      this.winner = -1; // Draw/Error state
    }
  }

  endTurn() {
    if (this.chainActive === null || this.chainActive === undefined) return false;
    const lastPos = this.chainActive;
    this.chainActive = null;
    this.lastJumpedOver = null;
    if (!this.gameOver) {
      this._advanceTurn(lastPos);
    }
    return true;
  }

  _checkGameEnd() {
    const counts = this._getMarbleCounts();
    
    // Count how many players still have marbles (> 0)
    let playersAlive = 0;
    let lastAlive = 0;
    for (let p = 0; p < this.numPlayers; p++) {
      if (counts[p] > 0) {
        playersAlive++;
        lastAlive = p;
      }
    }
    
    // Game ends when only 1 player has marbles left
    if (playersAlive <= 1) {
      this.gameOver = true;
      this.winner = lastAlive;
      return;
    }
    
    // In 2-player: also end if one player has 0 (other wins)
    // Already covered above
  }
}

function getBoardLayout() {
  const positions = [];
  for (let row = 0; row < NUM_ROWS; row++) {
    for (let col = 0; col <= row; col++) {
      const idx = rowColToIndex(row, col);
      positions.push({ idx, row, col });
    }
  }
  return positions;
}

// Issue #8: Export functions for AI-Player to avoid duplication
module.exports = { 
  Game, 
  getBoardLayout, 
  BOARD_SIZE, 
  CORNERS, 
  ADJACENCY, 
  NUM_ROWS,
  indexToRowCol,
  getJumpLanding
};
