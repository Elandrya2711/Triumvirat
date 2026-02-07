/**
 * Solo Mode Integration Test
 * Run: node test-solo.js
 * 
 * Tests the full solo game flow: isomorphic modules, AI computation,
 * game state transitions, chain jumps, game over detection.
 */

const { Game, ADJACENCY, CORNERS, BOARD_SIZE, getBoardLayout } = require('./game-logic');
const { AIPlayer } = require('./ai-player');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${msg}`); }
}

function test(name, fn) {
  console.log(`\n🧪 ${name}`);
  try { fn(); }
  catch (e) { failed++; console.error(`  ❌ EXCEPTION: ${e.message}`); }
}

// ============================================================
// Phase 1: Isomorphic Module Tests
// ============================================================

test('Game Logic exports all required symbols', () => {
  assert(typeof Game === 'function', 'Game is a function');
  assert(Array.isArray(ADJACENCY), 'ADJACENCY is array');
  assert(ADJACENCY.length === 28, 'ADJACENCY has 28 entries');
  assert(Array.isArray(CORNERS), 'CORNERS is array');
  assert(CORNERS.length === 3, 'CORNERS has 3 entries');
  assert(BOARD_SIZE === 28, 'BOARD_SIZE is 28');
  assert(typeof getBoardLayout === 'function', 'getBoardLayout exists');
});

test('AIPlayer exports and constructs', () => {
  assert(typeof AIPlayer === 'function', 'AIPlayer is a function');
  const ai = new AIPlayer(1, 'TestBot', 3);
  assert(ai.playerIndex === 1, 'playerIndex set');
  assert(ai.difficulty === 3, 'difficulty set');
  assert(ai.name === 'TestBot', 'name set');
});

test('Isomorphic export pattern present in source', () => {
  const fs = require('fs');
  const gl = fs.readFileSync('game-logic.js', 'utf8');
  const ap = fs.readFileSync('ai-player.js', 'utf8');
  assert(gl.includes('self.GameLogic'), 'game-logic has browser export');
  assert(gl.includes('module.exports'), 'game-logic has node export');
  assert(ap.includes('self.AIPlayer'), 'ai-player has browser export');
  assert(ap.includes('self.GameLogic'), 'ai-player imports from browser global');
});

// ============================================================
// Phase 2: Solo Game Simulation
// ============================================================

test('Solo game initialization (2 players)', () => {
  const game = new Game(2);
  const state = game.getState();
  assert(state.board.length === 28, 'Board has 28 positions');
  assert(state.currentPlayer === 0, 'Player 0 starts');
  assert(state.marbleCount[0] === 6, 'Player 0 has 6 marbles');
  assert(state.marbleCount[1] === 6, 'Player 1 has 6 marbles');
  assert(!state.gameOver, 'Game not over');
});

test('Solo game initialization (3 players)', () => {
  const game = new Game(3);
  const state = game.getState();
  assert(state.marbleCount[2] === 6, 'Player 2 has 6 marbles');
});

test('Human move → AI response cycle', () => {
  const game = new Game(2);
  
  // Human (player 0) makes a move
  const moves = game.getValidMoves();
  assert(moves.length > 0, 'Player 0 has valid moves');
  
  const move = moves[0];
  const result = game.makeMove(move.from, move.to);
  assert(result.valid, `Move ${move.from}→${move.to} is valid`);
  assert(game.currentPlayer === 1, 'Turn passed to player 1');
  
  // AI (player 1) computes a move
  const ai = new AIPlayer(1, 'Bot', 3);
  const aiMove = ai.chooseMove(game);
  assert(aiMove !== null, 'AI found a move');
  assert(typeof aiMove.from === 'number', 'AI move has from');
  assert(typeof aiMove.to === 'number', 'AI move has to');
  
  const aiResult = game.makeMove(aiMove.from, aiMove.to);
  assert(aiResult.valid, `AI move ${aiMove.from}→${aiMove.to} is valid`);
  
  // Handle chain if active
  if (aiResult.chainActive !== null) {
    game.endTurn();
  }
  assert(game.currentPlayer === 0, 'Turn back to player 0');
});

test('AI plays all 5 difficulty levels', () => {
  for (let diff = 1; diff <= 5; diff++) {
    const game = new Game(2);
    // Make a human move first
    const moves = game.getValidMoves();
    game.makeMove(moves[0].from, moves[0].to);
    
    const ai = new AIPlayer(1, 'Bot', diff);
    const start = Date.now();
    const move = ai.chooseMove(game);
    const elapsed = Date.now() - start;
    
    assert(move !== null, `Difficulty ${diff}: AI found a move`);
    assert(elapsed < 3000, `Difficulty ${diff}: computed in ${elapsed}ms (< 3s)`);
    console.log(`    Difficulty ${diff}: ${elapsed}ms`);
  }
});

test('Game state serialization roundtrip (Web Worker simulation)', () => {
  const game = new Game(2);
  // Make some moves
  const moves = game.getValidMoves();
  game.makeMove(moves[0].from, moves[0].to);
  
  // Serialize (like soloSerializeGame)
  const serialized = {
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
  
  // JSON roundtrip (simulates postMessage)
  const json = JSON.parse(JSON.stringify(serialized));
  
  // Reconstruct (like ai-worker.js does)
  const game2 = new Game(json.numPlayers);
  game2.board = json.board.map(c => c ? { ...c } : null);
  game2.currentPlayer = json.currentPlayer;
  game2.gameOver = json.gameOver;
  game2.winner = json.winner;
  game2.chainActive = json.chainActive;
  game2.lastJumpedOver = json.lastJumpedOver;
  game2.cornerForced = json.cornerForced ? { ...json.cornerForced } : {};
  game2.playerMarbles = {};
  for (let p = 0; p < json.numPlayers; p++) game2.playerMarbles[p] = [];
  for (let i = 0; i < game2.board.length; i++) {
    if (game2.board[i]) game2.playerMarbles[game2.board[i].player].push(i);
  }
  
  // Verify reconstructed game works
  const ai = new AIPlayer(1, 'Bot', 3);
  const aiMove = ai.chooseMove(game2);
  assert(aiMove !== null, 'AI can play on reconstructed game');
  
  const result = game2.makeMove(aiMove.from, aiMove.to);
  assert(result.valid, 'Move valid on reconstructed game');
  
  // Verify state matches
  assert(game2.board.length === game.board.length, 'Board size matches');
  assert(game2.numPlayers === game.numPlayers, 'numPlayers matches');
});

test('Full solo game simulation (AI vs AI, max 200 turns)', () => {
  const game = new Game(2);
  const ai0 = new AIPlayer(0, 'Bot0', 3);
  const ai1 = new AIPlayer(1, 'Bot1', 3);
  const ais = [ai0, ai1];
  
  let turns = 0;
  const maxTurns = 200;
  
  while (!game.gameOver && turns < maxTurns) {
    const ai = ais[game.currentPlayer];
    const move = ai.chooseMove(game);
    if (!move) break;
    
    const result = game.makeMove(move.from, move.to);
    if (!result.valid) break;
    
    // Handle chains
    let chainSteps = 0;
    while (game.chainActive !== null && chainSteps < 10) {
      const cont = ai.chooseContinuation(game);
      if (!cont) { game.endTurn(); break; }
      const cr = game.makeMove(cont.from, cont.to);
      if (!cr.valid) { game.endTurn(); break; }
      chainSteps++;
    }
    if (game.chainActive !== null) game.endTurn();
    
    turns++;
  }
  
  console.log(`    Played ${turns} turns, gameOver: ${game.gameOver}`);
  if (game.gameOver) {
    console.log(`    Winner: Player ${game.winner}`);
    const counts = game.getState().marbleCount;
    console.log(`    Final marbles: ${counts.join(' vs ')}`);
  }
  
  assert(turns > 0, 'At least 1 turn played');
  assert(turns < maxTurns || game.gameOver, 'Game ended or hit turn limit');
});

test('Corner forced serialization', () => {
  const game = new Game(2);
  game.cornerForced = { 0: 21 };
  
  const serialized = JSON.parse(JSON.stringify({
    cornerForced: game.cornerForced ? { ...game.cornerForced } : {}
  }));
  
  // Keys become strings in JSON
  assert(serialized.cornerForced['0'] === 21, 'cornerForced survives JSON roundtrip');
});

test('Web Worker file exists and has correct structure', () => {
  const fs = require('fs');
  const ww = fs.readFileSync('public/ai-webworker.js', 'utf8');
  assert(ww.includes("importScripts('/game-logic.js', '/ai-player.js')"), 'Imports correct files');
  assert(ww.includes('onmessage'), 'Has message handler');
  assert(ww.includes('chooseMove'), 'Handles chooseMove');
  assert(ww.includes('chooseContinuation'), 'Handles chooseContinuation');
  assert(ww.includes('reconstructGame'), 'Has reconstructGame');
  assert(ww.includes('self.GameLogic'), 'Uses GameLogic global');
});

test('Server serves isomorphic files', async () => {
  try {
    const http = require('http');
    const fetch = (url) => new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }).on('error', reject);
    });
    
    const gl = await fetch('http://localhost:3000/game-logic.js');
    assert(gl.status === 200, 'game-logic.js served (200)');
    assert(gl.body.includes('self.GameLogic'), 'game-logic.js has browser export');
    
    const ap = await fetch('http://localhost:3000/ai-player.js');
    assert(ap.status === 200, 'ai-player.js served (200)');
    assert(ap.body.includes('self.AIPlayer'), 'ai-player.js has browser export');
    
    const ww = await fetch('http://localhost:3000/ai-webworker.js');
    assert(ww.status === 200, 'ai-webworker.js served (200)');
  } catch (e) {
    console.log('    ⚠️ Server not running, skipping HTTP tests');
  }
});

// ============================================================
// Results
// ============================================================

setTimeout(() => {
  console.log('\n========================================');
  if (failed === 0) {
    console.log(`✅ Passed: ${passed}`);
    console.log('🎉 All tests passed!');
  } else {
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
  }
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}, 500); // Wait for async tests
