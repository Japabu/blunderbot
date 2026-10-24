import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { queenLoss } from '../queen-loss.mjs';

function capture(fen, san, watchedColor = 'w') {
    const board = new Chess(fen), beforeFen = board.fen(), move = board.move(san);
    return { beforeFen, afterFen: board.fen(), move, watchedColor };
}

test('the actual i5zvigAD 20...Qxe3 21.Rxe3 queen exchange has no loss scream', () => {
    const position = capture('2r2r1k/1p3ppp/1q1p2b1/p3p3/P1B1P1Pb/1P2Q2P/3N1P2/2R1R1K1 b - - 4 20', 'Qxe3');
    assert.equal(position.move.lan, 'b6e3');
    assert.equal(position.afterFen, '2r2r1k/1p3ppp/3p2b1/p3p3/P1B1P1Pb/1P2q2P/3N1P2/2R1R1K1 w - - 0 21');
    assert.equal(queenLoss(position), null);
    assert.equal(queenLoss({ ...position, move: 'b6e3' }), null, 'UCI and verbose moves agree');
});

test('a hanging watched queen is a real material loss for either color', () => {
    for (const [fen, san, watchedColor] of [
        ['3r3k/8/8/8/3Q4/8/8/K7 b - - 0 1', 'Rxd4', 'w'],
        ['7k/8/8/3q4/8/8/8/K2R4 w - - 0 1', 'Rxd5', 'b'],
    ]) {
        const position = capture(fen, san, watchedColor);
        assert.deepEqual(queenLoss(position), {
            slot: 'lost_queen', square: position.move.to, capturer: 'r', uci: position.move.lan, netLoss: 900,
        });
        assert.equal(queenLoss({ ...position, watchedColor: position.move.color }), null, 'taking the enemy queen is not losing yours');
    }
});

test('safe queen exchanges stay quiet but losing a queen for a rook still matters', () => {
    const fair = capture('3q3k/8/8/8/3Q4/8/8/K2R4 b - - 0 1', 'Qxd4+');
    assert.equal(queenLoss(fair), null);
    const exchangeLoss = capture('3r3k/8/8/8/3Q4/8/8/K2R4 b - - 0 1', 'Rxd4+');
    assert.equal(queenLoss(exchangeLoss)?.netLoss, 400);
});

test('an illegal pinned recapture cannot turn a queen loss into a fair exchange', () => {
    const pinned = capture('3q3k/8/8/8/3Q4/8/8/r2R3K b - - 0 1', 'Qxd4');
    const board = new Chess(pinned.afterFen);
    assert.equal(board.moves({ verbose: true }).some(move => move.lan === 'd1d4'), false);
    assert.equal(queenLoss(pinned)?.netLoss, 900);
});

test('a recently verified sound queen sacrifice suppresses its loss scream only on the offered square', () => {
    const offer = capture('6k1/8/6p1/7Q/8/8/5PPP/6K1 b - - 1 1', 'gxh5');
    assert.equal(queenLoss(offer)?.netLoss, 900);
    assert.equal(queenLoss({ ...offer, verifiedSacrificeSquare: 'h5' }), null);
    assert.equal(queenLoss({ ...offer, verifiedSacrificeSquare: 'd4' })?.netLoss, 900);
});

test('missing history, stale snapshots, fabricated metadata and non-queen captures stay quiet', () => {
    const position = capture('3r3k/8/8/8/3Q4/8/8/K7 b - - 0 1', 'Rxd4');
    assert.equal(queenLoss(), null);
    for (const changes of [
        { beforeFen: null }, { afterFen: null }, { beforeFen: 'invalid' }, { afterFen: 'invalid' },
        { afterFen: position.beforeFen }, { watchedColor: undefined }, { move: 'd8d5' }, { move: null },
        { move: { from: 'd8', to: 'd5', captured: 'q' } },
    ]) assert.equal(queenLoss({ ...position, ...changes }), null);
    const pawn = capture('3r3k/8/8/8/3P4/8/8/K7 b - - 0 1', 'Rxd4');
    assert.equal(queenLoss({ ...pawn, move: { ...pawn.move, captured: 'q' } }), null);
});
