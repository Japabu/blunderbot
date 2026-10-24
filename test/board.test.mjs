import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { hasNewHigherPieceAttack, higherPieceAttack } from '../board.mjs';

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

test('uncovering a line is a discovery, while a direct knight attack uses the gun', () => {
    for (const [fen, san, expected] of [
        ['k7/8/7q/8/8/8/3N4/K1B5 w - - 0 1', 'Nf3', 'discovery'],
        ['k7/8/7n/8/8/8/3N4/K1B5 w - - 0 1', 'Nf3', 'discovery'],
        ['k7/8/8/4q3/8/8/K7/6N1 w - - 0 1', 'Nf3', 'attack_up'],
        ['7k/8/8/8/3r4/8/4K3/8 w - - 0 1', 'Ke3', null],
    ]) {
        const board = new Chess(fen), before = board.fen(), move = board.move(san);
        assert.equal(higherPieceAttack(before, board.fen(), move.color, move.from, move.to), expected, san);
    }
});

test('fossil only announces meaningful discovered tactics, not trades or loose pawns', () => {
    for (const [fen, san, expected] of [
        ['7q/7r/7k/8/3N4/8/8/QK6 w - - 0 1', 'Nf3', null],
        ['7k/6p1/8/8/3N4/8/8/QK6 w - - 0 1', 'Nf3', null],
        ['7q/8/7k/8/3N4/8/8/QK6 w - - 0 1', 'Nf3', 'discovery'],
        ['8/8/7k/8/8/8/3N4/K1B5 w - - 0 1', 'Nf3+', 'discovery'],
    ]) {
        const board = new Chess(fen), before = board.fen(), move = board.move(san);
        assert.equal(higherPieceAttack(before, board.fen(), move.color, move.from, move.to), expected, fen);
    }
});

test('reload ignores maintained sliding threats and old attacks made legal by escaping check', () => {
    for (const [fen, san] of [
        ['k7/8/8/4q3/8/8/K7/4R3 w - - 0 1', 'Re2'],
        ['r6k/8/4q3/8/8/8/8/K3R3 w - - 0 1', 'Kb1'],
    ]) {
        const board = new Chess(fen), before = board.fen(), move = board.move(san);
        assert.equal(higherPieceAttack(before, board.fen(), move.color, move.from, move.to), null);
    }
});

test('actual LdTagjRO fossil false positives stay quiet or use the direct-attack sound', () => {
    for (const [fen, san, expected] of [
        ['r3kb1r/p2npppp/2p2n2/qp1P3b/2B5/2N2P2/PPP1N1PP/R1BQ1RK1 w kq - 0 10', 'dxc6', 'attack_up'],
        ['r3kb1r/4pppp/p1P5/2q1n2b/B5n1/2N2P2/PPP1N1PP/R1B1QR1K b kq - 5 14', 'Nxh2', 'attack_up'],
        ['r3kb1r/4pppp/p1n5/2q4b/B7/2N2P2/PPP1N1PK/R1B1QR2 w kq - 0 16', 'Ng3', null],
    ]) {
        const board = new Chess(fen), move = board.move(san);
        assert.equal(higherPieceAttack(fen, board.fen(), move.color, move.from, move.to), expected, san);
    }
});
