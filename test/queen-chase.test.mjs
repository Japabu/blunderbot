import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { QueenChase } from '../queen-chase.mjs';

const PAWN_CHASE = '8/k7/1pppp3/8/3Q4/8/8/K7 b - - 0 1';

function game(fen = PAWN_CHASE) {
    const board = new Chess(fen), tracker = new QueenChase();
    let ply = 0;
    const play = (uci, advance = 1) => {
        const beforeFen = board.fen();
        const move = board.move(uci);
        ply += advance;
        return tracker.observe({ beforeFen, afterFen: board.fen(), move, ply });
    };
    return { board, tracker, play };
}

test('first queen escape is quiet, second and subsequent consecutive escapes react', () => {
    const { play } = game();
    assert.equal(play('c6c5'), false);
    assert.equal(play('d4e4'), false);
    assert.equal(play('d6d5'), false);
    assert.equal(play('e4f4'), true);
    assert.equal(play('e6e5'), false);
    assert.equal(play('f4g4'), true);
});

test('either color can be the chased queen', () => {
    const { play } = game('7k/8/8/4q3/8/3PPPP1/7K/8 w - - 0 1');
    assert.deepEqual(['f3f4', 'e5d5', 'e3e4', 'd5c5'].map(move => play(move)), [false, false, false, true]);
});

test('new knight, bishop and rook attacks can begin a consecutive chase', () => {
    const examples = [
        ['6n1/k7/1pppp3/3Q4/8/8/8/K7 b - - 0 1', ['g8f6', 'd5d4', 'c6c5', 'd4c4']],
        ['8/k7/1p6/2p3b1/3Q4/8/8/7K b - - 0 1', ['g5f6', 'd4d3', 'c5c4', 'd3e3']],
        ['8/k1r5/1p1pp3/3Q4/8/8/8/K7 b - - 0 1', ['c7c5', 'd5e4', 'd6d5', 'e4f4']],
    ];
    for (const [fen, moves] of examples) {
        const { play } = game(fen);
        assert.deepEqual(moves.map(move => play(move)), [false, false, false, true], moves.join(' '));
    }
});

test('a non-chasing opponent move breaks the sequence', () => {
    const { play } = game();
    play('c6c5'); play('d4e4');
    assert.equal(play('a7a6'), false);
    assert.equal(play('e4f4'), false);
    assert.equal(play('e6e5'), false);
    assert.equal(play('f4g4'), false);
});

test('moving another piece instead of fleeing breaks the chase', () => {
    const { play } = game();
    play('c6c5');
    assert.equal(play('a1a2'), false);
    assert.equal(play('d6d5'), false);
    assert.equal(play('d4e4'), false);
});

test('an unsafe queen move does not count as an escape', () => {
    const { play } = game();
    play('c6c5');
    assert.equal(play('d4b4'), false); // The same pawn can still take the queen.
    assert.equal(play('d6d5'), false);
    assert.equal(play('b4a3'), false);
});

test('fleeing into a different pawn attack is still unsafe', () => {
    const { play } = game();
    play('c6c5'); play('d4e4'); play('d6d5');
    assert.equal(play('e4f5'), false); // e6 can take the queen on f5.
});

test('capturing a pursuer is not running away', () => {
    const { play } = game();
    play('c6c5');
    assert.equal(play('d4c5'), false);
    assert.equal(play('d6d5'), false);
    assert.equal(play('c5d4'), false);
});

test('queen-versus-queen attacks never create a running reaction', () => {
    const { play } = game('8/k7/1pq5/8/3Q4/8/8/K7 b - - 0 1');
    for (const move of ['c6c5', 'd4e4', 'c5d5', 'e4f4']) assert.equal(play(move), false);
});

test('a legal king capture ends the queen identity instead of creating a chase', () => {
    const { play } = game('8/8/8/4k3/3Q4/8/8/K7 b - - 0 1');
    assert.equal(play('e5d4'), false);
    assert.equal(play('a1a2'), false);
    assert.equal(play('d4d5'), false);
});

test('a pinned knight cannot start a chase with an illegal queen capture', () => {
    const { play } = game('5kn1/8/1p6/3Q4/8/8/8/K4R2 b - - 0 1');
    assert.equal(play('g8f6'), false); // Blocking check, but pinned to its own king.
    assert.equal(play('d5c4'), false);
    assert.equal(play('b6b5'), false);
    assert.equal(play('c4d4'), false); // Only the first real escape.
});

test('a maintained rook attack does not count as a fresh pursuit', () => {
    const { play } = game('8/k7/1p6/8/r2Q4/8/8/7K b - - 0 1');
    assert.equal(play('a4b4'), false); // The rook already attacked d4 from a4.
    assert.equal(play('d4c3'), false);
    assert.equal(play('b4b3'), false);
    assert.equal(play('c3d2'), false);
});

test('a missing move discards the preceding escape', () => {
    const { play } = game();
    play('c6c5'); play('d4e4');
    assert.equal(play('d6d5', 2), false);
    assert.equal(play('e4f4'), false);
});

test('reset clears a complete prior chase', () => {
    const { play, tracker } = game();
    play('c6c5'); play('d4e4');
    tracker.reset();
    play('d6d5');
    assert.equal(play('e4f4'), false);
});

test('a mismatched position is ignored and clears the chase', () => {
    const { play, board, tracker } = game();
    play('c6c5'); play('d4e4');
    const beforeFen = board.fen(), move = board.move('d6d5');
    assert.equal(tracker.observe({ beforeFen, afterFen: beforeFen, move, ply: 3 }), false);
    assert.equal(play('e4f4', 2), false);
});

test('a different history with consecutive ply numbers cannot inherit an escape', () => {
    const { play, board, tracker } = game();
    play('c6c5'); play('d4e4');
    const replacement = new Chess(board.fen().replace('/K7 ', '/1K6 '));
    let beforeFen = replacement.fen(), move = replacement.move('d6d5');
    assert.equal(tracker.observe({ beforeFen, afterFen: replacement.fen(), move, ply: 3 }), false);
    beforeFen = replacement.fen(); move = replacement.move('e4f4');
    assert.equal(tracker.observe({ beforeFen, afterFen: replacement.fen(), move, ply: 4 }), false);
});
