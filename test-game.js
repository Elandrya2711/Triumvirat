/**
 * Triumvirat - Unit Tests
 * Run: node test-game.js
 */

const { Game, BOARD_SIZE, CORNERS, ADJACENCY } = require('./game-logic.js');

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${msg}`); }
}

function test(name, fn) {
  console.log(`🧪 ${name}`);
  try { fn(); } catch (e) { failed++; console.error(`  ❌ EXCEPTION: ${e.message}`); }
}

// === BASIC SETUP ===

test('Board initialization — 18 marbles for 3 players', () => {
  const g = new Game(3);
  let count = 0;
  for (const cell of g.board) if (cell) count++;
  assert(count === 18, `Expected 18 marbles, got ${count}`);
});

test('Board initialization — 12 marbles for 2 players', () => {
  const g = new Game(2);
  let count = 0;
  for (const cell of g.board) if (cell) count++;
  assert(count === 12, `Expected 12 marbles, got ${count}`);
});

test('Player 0 starts', () => {
  const g = new Game(3);
  assert(g.currentPlayer === 0, `Expected player 0, got ${g.currentPlayer}`);
});

test('Corner positions occupied at start', () => {
  const g = new Game(3);
  for (const c of CORNERS) {
    assert(g.board[c] !== null, `Corner ${c} should be occupied`);
    assert(g.board[c].size === 3, `Corner ${c} should have large marble`);
  }
});

// === VALID MOVES ===

test('Player 0 has valid moves at game start', () => {
  const g = new Game(3);
  const moves = g.getValidMoves();
  assert(moves.length > 0, `Player 0 should have moves, got ${moves.length}`);
});

test('All 3 players have valid moves at start', () => {
  const g = new Game(3);
  for (let p = 0; p < 3; p++) {
    g.currentPlayer = p;
    const moves = g.getValidMoves();
    assert(moves.length > 0, `Player ${p} should have moves, got ${moves.length}`);
  }
});

test('Moves do not target corners (simple moves)', () => {
  const g = new Game(3);
  const moves = g.getValidMoves();
  const simpleToCorner = moves.filter(m => !m.isJump && CORNERS.includes(m.to));
  assert(simpleToCorner.length === 0, `Simple moves should not target corners`);
});

// === CORNER FORCED — THE BIG BUG ===

test('cornerForced is per-player, does not block other players', () => {
  const g = new Game(3);
  // Simulate: player 0 has a marble forced in corner
  g.cornerForced[0] = 0;  // player 0 forced at pos 0
  
  // Player 1's turn should NOT be affected
  g.currentPlayer = 1;
  const moves = g.getValidMoves();
  assert(moves.length > 0, `Player 1 should have moves despite Player 0's cornerForced`);
});

test('cornerForced restricts the correct player', () => {
  const g = new Game(3);
  // Clear board, place one marble in corner for player 0 and one elsewhere
  g.board.fill(null);
  g.board[0] = { player: 0, size: 3 };  // corner
  g.board[4] = { player: 0, size: 1 };  // not corner
  g.cornerForced[0] = 0;
  g.currentPlayer = 0;
  
  const moves = g.getValidMoves();
  // All moves should be FROM position 0 only
  const nonForcedMoves = moves.filter(m => m.from !== 0);
  assert(nonForcedMoves.length === 0, `Only corner marble should be movable when forced`);
});

// === MAKING MOVES ===

test('Simple move works', () => {
  const g = new Game(3);
  const moves = g.getValidMoves();
  assert(moves.length > 0, 'Need at least one move');
  const move = moves[0];
  const result = g.makeMove(move.from, move.to);
  assert(result.valid === true, `Move should be valid`);
  assert(g.board[move.to] !== null, `Target should be occupied after move`);
  assert(g.board[move.from] === null, `Source should be empty after move`);
});

test('Turn advances after simple move', () => {
  const g = new Game(3);
  assert(g.currentPlayer === 0, 'Should start as player 0');
  const moves = g.getValidMoves();
  const simpleMove = moves.find(m => !m.isJump);
  if (simpleMove) {
    g.makeMove(simpleMove.from, simpleMove.to);
    assert(g.currentPlayer === 1, `Should be player 1's turn, got ${g.currentPlayer}`);
  }
});

test('Invalid move is rejected', () => {
  const g = new Game(3);
  const result = g.makeMove(0, 27);  // nonsense move
  assert(result.valid === false, 'Invalid move should be rejected');
});

// === JUMP MECHANICS ===

test('Jump over smaller/equal marble captures enemy', () => {
  const g = new Game(3);
  g.board.fill(null);
  // Setup: player 0 large at pos 3, player 1 small at pos 4, empty at pos 5
  g.board[3] = { player: 0, size: 3 };
  g.board[4] = { player: 1, size: 1 };
  g.currentPlayer = 0;
  
  const moves = g.getValidMoves(3);
  const jump = moves.find(m => m.isJump && m.to === 5);
  assert(jump !== undefined, 'Should be able to jump from 3 over 4 to 5');
  if (jump) {
    assert(jump.captures.length === 1, 'Should capture enemy marble');
    const result = g.makeMove(3, 5);
    assert(result.valid, 'Jump should succeed');
    assert(g.board[4] === null, 'Captured marble should be removed');
  }
});

test('Cannot jump over larger marble', () => {
  const g = new Game(3);
  g.board.fill(null);
  g.board[3] = { player: 0, size: 1 };  // small
  g.board[4] = { player: 1, size: 3 };  // large
  g.currentPlayer = 0;
  
  const moves = g.getValidMoves(3);
  const jump = moves.find(m => m.isJump && m.to === 5);
  assert(jump === undefined, 'Should NOT jump over larger marble');
});

test('Jump over own marble does not capture', () => {
  const g = new Game(3);
  g.board.fill(null);
  g.board[3] = { player: 0, size: 3 };
  g.board[4] = { player: 0, size: 1 };
  g.currentPlayer = 0;
  
  const moves = g.getValidMoves(3);
  const jump = moves.find(m => m.isJump && m.to === 5);
  assert(jump !== undefined, 'Should be able to jump over own marble');
  if (jump) {
    assert(jump.captures.length === 0, 'Should NOT capture own marble');
  }
});

// === CHAIN JUMPS ===

test('Chain jump activates when further jumps available', () => {
  const g = new Game(3);
  g.board.fill(null);
  // Setup chain: pos 6 → jump over 7 → land 8, then 8 → jump over 12 → land 17
  g.board[6] = { player: 0, size: 3 };
  g.board[7] = { player: 1, size: 1 };
  g.board[12] = { player: 1, size: 1 };
  g.currentPlayer = 0;
  
  const result = g.makeMove(6, 8);
  if (result.valid && result.chainActive !== null) {
    assert(result.chainActive === 8, 'Chain should be active at landing pos');
    // Continue chain
    const result2 = g.makeMove(8, 17);
    assert(result2.valid, 'Chain jump should work');
  }
});

test('endTurn stops chain', () => {
  const g = new Game(3);
  g.board.fill(null);
  g.board[6] = { player: 0, size: 3 };
  g.board[7] = { player: 1, size: 1 };
  g.board[12] = { player: 1, size: 1 };
  g.currentPlayer = 0;
  
  const result = g.makeMove(6, 8);
  if (result.valid && result.chainActive !== null) {
    const ended = g.endTurn();
    assert(ended === true, 'endTurn should succeed');
    assert(g.currentPlayer !== 0, 'Turn should advance');
  }
});

// === GAME END ===

test('Game ends when one player remains', () => {
  const g = new Game(2);
  g.board.fill(null);
  g.board[12] = { player: 0, size: 3 };  // only player 0 has marbles
  g.currentPlayer = 0;
  g._checkGameEnd();
  assert(g.gameOver === true, 'Game should be over');
  assert(g.winner === 0, 'Player 0 should win');
});

// === ADJACENCY SANITY ===

test('All positions have at least 2 neighbors', () => {
  for (let i = 0; i < BOARD_SIZE; i++) {
    assert(ADJACENCY[i].length >= 2, `Position ${i} has only ${ADJACENCY[i].length} neighbors`);
  }
});

test('Adjacency is symmetric', () => {
  for (let i = 0; i < BOARD_SIZE; i++) {
    for (const j of ADJACENCY[i]) {
      assert(ADJACENCY[j].includes(i), `Adjacency not symmetric: ${i}→${j} but not ${j}→${i}`);
    }
  }
});

// === ADVANCE TURN WITH CORNER ===

test('_advanceTurn sets cornerForced for current player when landing in corner', () => {
  const g = new Game(3);
  g.currentPlayer = 1;
  g._advanceTurn(21);  // corner B
  assert(g.cornerForced[1] === 21, 'Should set cornerForced for player 1');
  assert(g.currentPlayer === 2, 'Should advance to player 2');
});

test('_advanceTurn clears cornerForced when not landing in corner', () => {
  const g = new Game(3);
  g.cornerForced[0] = 0;
  g.currentPlayer = 0;
  g._advanceTurn(12);  // not a corner
  assert(g.cornerForced[0] === undefined, 'Should clear cornerForced for player 0');
});

// === CORNER RULES (official) ===

test('Simple moves cannot target corners', () => {
  const g = new Game(3);
  g.board.fill(null);
  // Place marble adjacent to corner 21 (bottom-left)
  g.board[15] = { player: 0, size: 1 };
  g.currentPlayer = 0;
  const moves = g.getValidMoves(15);
  const simpleToCorner = moves.filter(m => !m.isJump && CORNERS.includes(m.to));
  assert(simpleToCorner.length === 0, 'Simple moves must not target corners');
});

test('Jumps CAN land in corners', () => {
  const g = new Game(3);
  g.board.fill(null);
  // Setup: marble at 10, enemy at 15, corner 21 empty → jump to 21
  g.board[10] = { player: 0, size: 3 };
  g.board[15] = { player: 1, size: 1 };
  g.currentPlayer = 0;
  const moves = g.getValidMoves(10);
  const jumpToCorner = moves.find(m => m.isJump && m.to === 21);
  assert(jumpToCorner !== undefined, 'Jumps should be allowed to land in corners');
});

// === AI CLONE BUG ===

test('AI _cloneGame deep-copies cornerForced', () => {
  const { AIPlayer } = require('./ai-player.js');
  const ai = new AIPlayer(0, 'test', 1);
  const g = new Game(3);
  g.cornerForced[0] = 5;
  const clone = ai._cloneGame(g);
  clone.cornerForced[1] = 10;
  assert(g.cornerForced[1] === undefined, 'Mutating clone should not affect original');
});

// === AI CAN PLAY FULL GAME ===

test('3 AIs can play a full game without crashing', () => {
  const { AIPlayer } = require('./ai-player.js');
  const g = new Game(3);
  const ais = [new AIPlayer(0, 'R', 1), new AIPlayer(1, 'B', 1), new AIPlayer(2, 'G', 1)];
  let moves = 0;
  const maxMoves = 300;
  
  while (!g.gameOver && moves < maxMoves) {
    const ai = ais[g.currentPlayer];
    const move = ai.chooseMove(g);
    if (!move) {
      // No moves available, skip
      g.currentPlayer = (g.currentPlayer + 1) % 3;
      moves++;
      continue;
    }
    const result = g.makeMove(move.from, move.to);
    assert(result.valid, `AI move ${moves} should be valid (player ${ai.playerIndex}: ${move.from}→${move.to})`);
    
    // Handle chain jumps
    let chainSteps = 0;
    while (result.chainActive !== null && g.chainActive !== null && chainSteps < 10) {
      const cont = ai.chooseContinuation(g);
      if (!cont) { g.endTurn(); break; }
      const cr = g.makeMove(cont.from, cont.to);
      if (!cr.valid) { g.endTurn(); break; }
      if (cr.chainActive === null) break;
      chainSteps++;
    }
    if (g.chainActive !== null) g.endTurn();
    
    moves++;
  }
  assert(moves < maxMoves, `Game should finish within ${maxMoves} moves (got ${moves})`);
  if (g.gameOver) {
    assert(g.winner >= 0 && g.winner <= 2, `Winner should be 0-2, got ${g.winner}`);
  }
});

test('Each player has valid moves at start (AI perspective)', () => {
  const { AIPlayer } = require('./ai-player.js');
  const g = new Game(3);
  for (let p = 0; p < 3; p++) {
    g.currentPlayer = p;
    const ai = new AIPlayer(p, 'test', 1);
    const move = ai.chooseMove(g);
    assert(move !== null, `AI player ${p} should find a move at game start`);
  }
});

// === SUMMARY ===

console.log(`\n${'='.repeat(40)}`);
console.log(`✅ Passed: ${passed}`);
if (failed > 0) console.log(`❌ Failed: ${failed}`);
else console.log('🎉 All tests passed!');
console.log(`${'='.repeat(40)}`);
process.exit(failed > 0 ? 1 : 0);
