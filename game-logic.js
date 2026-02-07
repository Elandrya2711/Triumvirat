/**
 * Triumvirat - Game Logic (Server-authoritative)
 * 
 * Triangular board with side length 5 = 21 positions.
 * Each player has 6 marbles (1 large=3, 2 medium=2, 3 small=1) in a corner.
 * 
 * Board layout (indices):
 *         0
 *        1  2
 *       3  4  5
 *      6  7  8  9
 *    10 11 12 13 14
 *   15 16 17 18 19 20
 *
 * Corner A (top) = 0, Corner B (bottom-left) = 15, Corner C (bottom-right) = 20
 * 
 * Player A zone: 0(large), 1,2(medium), 3,4,5(small)
 * Player B zone: 15(large), 10,16(medium), 6,11,17(small)  
 * Player C zone: 20(large), 14,19(medium), 9,13,18(small)
 */

const BOARD_SIZE = 21;
const NUM_ROWS = 6;

const CORNER_A = 0;
const CORNER_B = 15;
const CORNER_C = 20;
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
    return [
      { pos: 0, size: 3 },
      { pos: 1, size: 2 }, { pos: 2, size: 2 },
      { pos: 3, size: 1 }, { pos: 4, size: 1 }, { pos: 5, size: 1 }
    ];
  } else if (corner === CORNER_B) {
    return [
      { pos: 15, size: 3 },
      { pos: 10, size: 2 }, { pos: 16, size: 2 },
      { pos: 6, size: 1 }, { pos: 11, size: 1 }, { pos: 17, size: 1 }
    ];
  } else {
    return [
      { pos: 20, size: 3 },
      { pos: 14, size: 2 }, { pos: 19, size: 2 },
      { pos: 9, size: 1 }, { pos: 13, size: 1 }, { pos: 18, size: 1 }
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
    this.cornerForced = null;  // Position of marble forced to leave corner (set after jumping into corner)
    this._setupBoard();
  }

  _setupBoard() {
    const corners = [CORNER_A, CORNER_B, CORNER_C];
    for (let p = 0; p < this.numPlayers; p++) {
      for (const { pos, size } of getStartPositions(corners[p])) {
        this.board[pos] = { player: p, size };
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

    // If a marble was forced into a corner last turn, it must move out first
    const forcedCornerMarble = this.cornerForced;

    for (let i = 0; i < BOARD_SIZE; i++) {
      const cell = this.board[i];
      if (!cell || cell.player !== player) continue;
      if (forPos !== undefined && i !== forPos) continue;
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

    for (const cap of move.captures) {
      this.board[cap.pos] = null;
    }

    if (move.isJump) {
      this.lastJumpedOver = this._getJumpedPosition(from, to);
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
    // Set cornerForced if marble ended in a corner
    if (CORNERS.includes(lastTo)) {
      // Next player's turn, but the CURRENT player's marble is forced
      // Actually: the marble in corner belongs to current player, next turn they must move it
      // We need to track it for when this player's turn comes again... 
      // Wait - the rule is simpler: if YOU jump into a corner, YOUR NEXT TURN you must move it out
      // So we store which corner has a forced marble, checked when that player plays
      this.cornerForced = lastTo;
    } else {
      this.cornerForced = null;
    }
    this.currentPlayer = (this.currentPlayer + 1) % this.numPlayers;
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
    for (let p = 0; p < this.numPlayers; p++) {
      if (counts[p] <= 1) {
        this.gameOver = true;
        let maxCount = 0, winner = 0;
        for (let i = 0; i < this.numPlayers; i++) {
          if (counts[i] > maxCount) { maxCount = counts[i]; winner = i; }
        }
        this.winner = winner;
        return;
      }
    }
    
    // Also check if current player has no valid moves (pass or lose)
    // For simplicity, if no moves available, skip turn
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

module.exports = { Game, getBoardLayout, BOARD_SIZE, CORNERS, ADJACENCY, NUM_ROWS };
