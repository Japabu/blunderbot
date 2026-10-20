import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { GamePosition, HandAndBrain, pieceForBestMove, PIECE_NAMES } from '../hand-and-brain.mjs';
import { readFileSync } from 'node:fs';

const start = new Chess().fen();
const position = (fen = start, ply = 0, playerColor = 'w') => ({ gameId: 'game', fen, ply, playerColor });
const analysis = bestmove => ({ bestmove, score: 20, depth: 8 });
function setup(enabled = true) {
    const spoken = [];
    const state = { enabled };
    const brain = new HandAndBrain({ enabled: () => state.enabled, speak: piece => spoken.push(piece) });
    return { brain, spoken, state };
}

test('the cue names the moving piece of a legal engine move, never its square', () => {
    assert.equal(pieceForBestMove(start, 'e2e4'), 'pawn');
    assert.equal(pieceForBestMove(start, 'g1f3'), 'knight');
    const after = new Chess(); after.move('e4');
    assert.equal(pieceForBestMove(after.fen(), 'e7e5'), 'pawn');
    assert.equal(pieceForBestMove(start, 'e7e5'), null);
    assert.equal(pieceForBestMove(start, 'e2e5'), null);
    for (const bad of ['(none)', '0000', null, undefined, 'g1f3 trailing', 'e2e4q']) assert.equal(pieceForBestMove(start, bad), null);
});

test('pinned pieces and illegal castling are never cued', () => {
    assert.equal(pieceForBestMove('4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1', 'e2a2'), null);
    assert.equal(pieceForBestMove('4k3/8/8/8/8/8/8/4K2R w - - 0 1', 'e1g1'), null);
    assert.equal(pieceForBestMove('4k3/8/8/8/8/8/8/4K2R w K - 0 1', 'e1g1'), 'king');
});

test('promotions name a pawn, en passant names a pawn, and castling names the king', () => {
    assert.equal(pieceForBestMove('7k/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8n'), 'pawn');
    assert.equal(pieceForBestMove('7k/P7/8/8/8/8/8/4K3 w - - 0 1', 'a7a8'), null);
    assert.equal(pieceForBestMove('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6'), 'pawn');
    assert.equal(pieceForBestMove('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1c1'), 'king');
});

test('checkmate, stalemate, and malformed FEN produce no cue', () => {
    for (const fen of ['7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'invalid']) {
        assert.equal(pieceForBestMove(fen, 'h8h7'), null);
    }
});

test('complete move history retains lost castling rights after king returns home', () => {
    const game = new GamePosition({ moves: 'e4 e5 Ke2 Ke7 Ke1 Ke8' });
    assert.equal(game.valid, true);
    assert.equal(game.current.fen.split(' ')[2], '-');
    assert.equal(game.ply, 6);
});

test('a captured rook replaced by a promoted rook does not gain castling rights', () => {
    const game = new GamePosition({ initialFen: '4k3/8/8/8/8/8/8/R3K2R w - - 0 1' });
    assert.equal(game.valid, true);
    assert.equal(pieceForBestMove(game.current.fen, 'e1g1'), null);
});

test('joining an existing game uses its latest position, and old replayed moves never roll it back', () => {
    const game = new GamePosition({ moves: 'e4 e5 Nf3 Nc6' });
    const old = new Chess(); old.move('e4');
    const replay = game.observe({ ply: 1, san: 'e4', fen: old.fen().split(' ')[0] });
    assert.equal(replay.ply, 1);
    assert.equal(game.current.ply, 4);
    const live = new Chess(game.current.fen); live.move('Bb5');
    const next = game.observe({ ply: 5, san: 'Bb5', fen: live.fen().split(' ')[0] });
    assert.equal(next.move.piece, 'b');
    assert.equal(next.fen, live.fen());
    assert.equal(game.valid, true);
});

test('board gaps and inconsistent websocket updates fail closed until resynchronized', () => {
    for (const event of [
        { ply: 2, san: 'e5', fen: start.split(' ')[0] },
        { ply: 1, san: 'e4', fen: start.split(' ')[0] },
        { ply: 1, san: 'invalid', fen: start.split(' ')[0] },
    ]) {
        const game = new GamePosition();
        assert.equal(game.observe(event), null);
        assert.equal(game.valid, false);
        assert.equal(game.needsSync, true);
    }
});

test('unsupported variants do not produce guessed standard-chess positions', () => {
    const game = new GamePosition({ variant: 'chess960' });
    assert.equal(game.supported, false);
    assert.equal(game.valid, false);
    assert.equal(game.needsSync, false);
});

test('starting FENs use their actual side to move and ply offset', () => {
    const game = new GamePosition({ variant: 'fromPosition', initialFen: '4k3/8/8/8/8/8/8/4K2R b - - 0 12' });
    assert.equal(game.valid, true);
    assert.equal(game.ply, 23);
    assert.equal(game.current.fen.split(' ')[1], 'b');
    assert.equal(new GamePosition({ status: 'resign' }).ended, true);
    assert.equal(new GamePosition({ status: 'started' }).ended, false);
});

test('the brain speaks once on the watched player turn, including the initial white turn', () => {
    const { brain, spoken } = setup();
    const p = position();
    brain.setPosition(p);
    brain.analyzed(p, analysis('g1f3'));
    brain.analyzed(p, analysis('g1f3'));
    assert.deepEqual(spoken, ['knight']);
});

test('disabled mode and opponent turns stay silent', () => {
    const { brain, spoken, state } = setup(false);
    const p = position();
    brain.setPosition(p); brain.analyzed(p, analysis('g1f3'));
    state.enabled = true;
    const opponentsTurn = position(start, 0, 'b');
    brain.setPosition(opponentsTurn); brain.analyzed(opponentsTurn, analysis('g1f3'));
    assert.deepEqual(spoken, []);
});

test('analysis arriving after a move, game switch, stop, or mode change cannot announce a stale piece', () => {
    const { brain, spoken, state } = setup();
    const old = position();
    brain.setPosition(old);
    brain.setPosition(position(start, 2));
    brain.analyzed(old, analysis('g1f3'));
    brain.reset(); brain.analyzed(old, analysis('g1f3'));
    brain.setPosition(old); state.enabled = false;
    brain.analyzed(old, analysis('g1f3'));
    assert.deepEqual(spoken, []);
});

test('failed engine responses never produce a cue', () => {
    const { brain, spoken } = setup();
    const p = position(); brain.setPosition(p);
    for (const result of [undefined, { bestmove: 'e2e4' }, { ...analysis('e2e4'), score: NaN }, { ...analysis('e2e4'), depth: 0 }, analysis('e2e5')]) {
        brain.analyzed(p, result);
    }
    assert.deepEqual(spoken, []);
});

test('moving a different piece receives feedback; correct moves and unrelated games do not', () => {
    const { brain, spoken } = setup();
    for (const move of [
        { gameId: 'game', ply: 1, piece: 'n' },
        { gameId: 'other-game', ply: 1, piece: 'p' },
        { gameId: 'game', ply: 3, piece: 'p' },
        { gameId: 'game', ply: 1, piece: 'p' },
    ]) {
        const p = position(); brain.setPosition(p); brain.analyzed(p, analysis('g1f3')); brain.moved(move);
    }
    assert.deepEqual(spoken, ['knight', 'knight', 'knight', 'knight', 'wrong_piece']);
});

test('all piece names and feedback have packaged nonempty Ogg Opus audio', () => {
    for (const name of [...Object.values(PIECE_NAMES), 'wrong_piece']) {
        const bytes = readFileSync(new URL(`../commentary/hand-and-brain/${name}.ogg`, import.meta.url));
        assert.equal(bytes.subarray(0, 4).toString(), 'OggS');
        assert.ok(bytes.includes(Buffer.from('OpusHead')));
        assert.ok(bytes.length > 1000, name);
    }
});

test('the piece repeats at three-second intervals without repeated analysis delaying it', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { brain, spoken } = setup();
    t.after(() => brain.reset());
    const p = position(); brain.setPosition(p); brain.analyzed(p, analysis('g1f3'));
    t.mock.timers.tick(2999);
    brain.setPosition(p); brain.analyzed(p, analysis('g1f3'));
    assert.deepEqual(spoken, ['knight']);
    t.mock.timers.tick(1);
    assert.deepEqual(spoken, ['knight', 'knight']);
    t.mock.timers.tick(3000);
    assert.deepEqual(spoken, ['knight', 'knight', 'knight']);
    brain.moved({ gameId: 'game', ply: 1, piece: 'n' });
    t.mock.timers.tick(9000);
    assert.equal(spoken.length, 3);
});

test('reminders stop on a new position, game end, reset, or disabling the mode', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    for (const cancel of [
        brain => brain.setPosition(position(start, 2)),
        brain => brain.setPosition(null),
        brain => brain.reset(),
        (_, state) => { state.enabled = false; },
    ]) {
        const { brain, spoken, state } = setup();
        const p = position(); brain.setPosition(p); brain.analyzed(p, analysis('e2e4'));
        t.mock.timers.tick(2999);
        cancel(brain, state);
        t.mock.timers.tick(9000);
        assert.deepEqual(spoken, ['pawn']);
        brain.reset();
    }
});
