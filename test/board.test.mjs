import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { hasNewHigherPieceAttack } from '../board.mjs';

function threat(fen, san) {
    const board = new Chess(fen);
    const before = board.fen();
    const move = board.move(san);
    return hasNewHigherPieceAttack(before, board.fen(), move.color);
}

test('pawn attacks trigger against pieces, but not against pawns', () => {
    for (const piece of ['n', 'b', 'r', 'q', 'p']) {
        assert.equal(threat(`4k3/8/8/3${piece}4/8/4P3/8/4K3 w - - 0 1`, 'e4'), piece !== 'p', piece);
    }
    assert.equal(threat('4k3/8/4p3/8/3Q4/8/8/K7 b - - 0 1', 'e5'), true, 'black pawn');
});

test('minor pieces threaten rooks and queens, and rooks threaten queens', () => {
    for (const piece of ['r', 'q', 'n', 'b']) {
        assert.equal(threat(`k7/8/8/4${piece}3/8/8/K7/6N1 w - - 0 1`, 'Nf3'), ['r', 'q'].includes(piece), piece);
    }
    assert.equal(threat('k7/8/8/8/3r4/8/8/K1B5 w - - 0 1', 'Bb2'), true);
    assert.equal(threat('k7/8/8/8/7q/8/8/K3R3 w - - 0 1', 'Re4'), true);
    assert.equal(threat('k7/8/8/8/7r/8/8/K3R3 w - - 0 1', 'Re4'), false, 'equal rooks');
    assert.equal(threat('k7/8/8/8/7q/8/8/K3Q3 w - - 0 1', 'Qe4'), false, 'queen versus queen');
});

test('new discovered attacks and attacks created by a capture trigger', () => {
    assert.equal(threat('k7/8/7q/8/8/8/3N4/K1B5 w - - 0 1', 'Nf3'), true);
    assert.equal(threat('k7/8/8/2q5/3p4/4P3/8/4K3 w - - 0 1', 'exd4'), true);
});

test('unrelated moves, blocked rays and absolutely pinned attackers do not trigger', () => {
    assert.equal(threat('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1', 'Kf1'), false);
    assert.equal(threat('k7/8/8/8/5P1q/8/8/K3R3 w - - 0 1', 'Re4'), false);
    assert.equal(threat('k3r3/8/8/3q4/8/8/4P3/4K3 w - - 0 1', 'e4'), false);
});

test('a defended higher-value target still counts as an attack', () => {
    assert.equal(threat('8/8/4k3/3r4/8/4P3/8/4K3 w - - 0 1', 'e4'), true);
});

test('checking the king, friendly pieces and missing exact history stay quiet', () => {
    assert.equal(threat('8/8/8/3k4/8/4P3/8/4K3 w - - 0 1', 'e4+'), false);
    assert.equal(threat('4k3/8/8/3R4/8/4P3/8/4K3 w - - 0 1', 'e4'), false);
    assert.equal(hasNewHigherPieceAttack(null, new Chess().fen(), 'w'), false);
    assert.equal(hasNewHigherPieceAttack('invalid', 'invalid', 'w'), false);
});

test('king attacks never trigger the reload sound, including a capturable queen', () => {
    for (const [fen, san, color] of [
        ['7k/8/8/8/8/3q4/8/4K3 b - - 0 1', 'Qd2+', 'w'],
        ['4k3/8/3Q4/8/8/8/8/7K w - - 0 1', 'Qd7+', 'b'],
    ]) {
        const board = new Chess(fen);
        board.move(san);
        assert.ok(board.moves({ verbose: true }).some(move => move.piece === 'k' && move.captured === 'q'));
        assert.equal(hasNewHigherPieceAttack(fen, board.fen(), color), false, color);
    }
    assert.equal(threat('7k/8/8/8/3r4/8/4K3/8 w - - 0 1', 'Ke3'), false);
});
