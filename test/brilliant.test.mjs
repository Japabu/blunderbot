import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { sacrificeCandidates, verifyBrilliant, verifyGreat } from '../brilliant.mjs';
import { exchangeGain } from '../tactics.mjs';
import { readFileSync } from 'node:fs';

function position(fen, san) {
    const board = new Chess(fen), beforeFen = board.fen(), move = board.move(san);
    return { beforeFen, afterFen: board.fen(), uci: move.lan };
}
const offer = position('6k1/8/6p1/8/8/8/5PPP/3Q2K1 w - - 0 1', 'Qh5');

test('sacrifices require actual material investment, excluding equal trades and winning captures', () => {
    assert.equal(sacrificeCandidates(offer.beforeFen, offer.afterFen, offer.uci)[0].investment, 900);
    const trade = position('3q3k/8/8/8/8/8/3Q4/3R2K1 w - - 0 1', 'Qd4+');
    assert.deepEqual(sacrificeCandidates(trade.beforeFen, trade.afterFen, trade.uci), []);
    const winning = position('7k/8/8/5p2/4q3/3B4/8/6K1 w - - 0 1', 'Bxe4');
    assert.deepEqual(sacrificeCandidates(winning.beforeFen, winning.afterFen, winning.uci), []);
    const exchange = position('7k/8/8/4b3/8/2Q5/3R4/6K1 w - - 0 1', 'Rd4');
    assert.equal(sacrificeCandidates(exchange.beforeFen, exchange.afterFen, exchange.uci)[0].investment, 200);
    assert.equal(exchangeGain(trade.afterFen, 'd8d4'), 0);
});

test('ordinary best moves stay quiet; only a verified gap to the next option earns Great', async () => {
    const baseline = { score: 100, depth: 8, variations: [
        { score: 100, depth: 8, moves: ['d1h5'] }, { score: -100, depth: 8, moves: ['d1d2'] },
    ] };
    let calls = 0;
    const analyze = async (fen, options) => {
        calls++;
        return options?.multipv ? { ...baseline, depth: 12, variations: baseline.variations.map(line => ({ ...line, depth: 12 })) }
            : { depth: 12, score: -100 };
    };
    assert.equal((await verifyGreat({ ...offer, baseline, analyze })).grade, 'great');
    assert.equal(calls, 2);
    const normal = { ...baseline, variations: baseline.variations.map(line => ({...line, score: 100})) };
    assert.equal(await verifyGreat({ ...offer, baseline: normal, analyze }), null);
    assert.equal(calls, 2, 'no deep search for ordinary good moves');
    assert.equal(await verifyGreat({ ...offer, baseline, analyze, isCurrent: () => false }), null);
    assert.equal(calls, 2);
});

test('the actual forced recaptures 23.Rxd2 and 28.Rxd6 do not earn Great or start deep searches', async () => {
    for (const [fen, san, previousMove] of [
        ['2r2r1k/1p3ppp/3p2b1/p3p3/P1B1P1P1/1P1R3P/3b1P2/2R3K1 w - - 0 23', 'Rxd2', { captured: 'n', to: 'd2' }],
        ['5r1k/1p4pp/2br1p2/p3p3/P1B3PP/1P6/5P2/3R2K1 w - - 0 28', 'Rxd6', { captured: 'r', to: 'd6' }],
    ]) {
        const p = position(fen, san);
        const baseline = { depth: 8, variations: [
            { depth: 8, score: 0, moves: [p.uci] }, { depth: 8, score: -500, moves: ['g1h2'] },
        ] };
        assert.equal(await verifyGreat({ ...p, previousMove, baseline, analyze: () => assert.fail('ordinary recapture started extra work') }), null);
    }
});

test('Morphy’s Nxb5 sacrifice is verified with the actual Pi engine’s depth-12 evidence', async () => {
    const rows = readFileSync(new URL('./fixtures/opera-sacrifice.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
    const proof = await verifyBrilliant({ beforeFen: rows[0].fen, afterFen: rows[1].fen, uci: 'c3b5',
        analyze: async fen => rows.find(row => row.fen === fen).result });
    assert.equal(proof?.slot, 'brilliant_move');
    assert.equal(proof?.sacrifice, 'b5');
});

test('brilliant verification requires alternatives, sound play, and compensation after acceptance', async () => {
    const calls = [];
    const good = { before: { depth: 12, score: 100, variations: [
        { rank: 1, depth: 12, score: 100, moves: ['d1h5'] },
        { rank: 2, depth: 12, score: 0, moves: ['d1d2'] },
    ] }, after: { depth: 12, score: -100 }, accepted: { depth: 12, score: 100 } };
    async function verify(results = good, isCurrent) {
        let n = 0;
        return verifyBrilliant({ ...offer, isCurrent, analyze: async (fen, options) => {
            calls.push({ fen, options }); return [results.before, results.after, results.accepted][n++];
        } });
    }
    assert.equal((await verify()).slot, 'brilliant_move');
    assert.equal(calls[0].options.multipv, 2);
    assert.equal(new Chess(calls[2].fen).get('h5').color, 'b', 'check the position after the sacrifice is accepted');
    assert.equal(await verify({ ...good, accepted: { depth: 12, score: -200 } }), null, 'a losing sacrifice is not brilliant');
    assert.equal(await verify({ ...good, after: { depth: 12, score: 200 } }), null, 'the opponent may decline and refute the move');
    assert.equal(await verify({ ...good, before: { ...good.before, variations: good.before.variations.map(line => ({...line, score: 500})) } }), null, 'already winning without the sacrifice');
    assert.equal(await verify({ ...good, before: { ...good.before, variations: [] } }), null, 'missing engine support fails closed');
    assert.equal(await verify({ ...good, accepted: { depth: 8, score: 100 } }), null);
    const beforeCancel = calls.length;
    assert.equal(await verify(good, () => false), null);
    assert.equal(calls.length, beforeCancel, 'cancelled positions start no searches');
});
