import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmBadMove } from '../quality-confirmation.mjs';

const input = { beforeFen: 'before', afterFen: 'after', before: { score: 0, depth: 8, bestmove: 'e2e4' },
    after: { score: 200, depth: 8 }, uci: 'd2d4', thinkTime: 2 };
test('suspected bad moves receive two finite deeper checks; a normal move receives none', async () => {
    const calls = [];
    const analyze = async fen => { calls.push(fen); return { score: 0, depth: 12, bestmove: 'e2e4' }; };
    const result = await confirmBadMove({ ...input, analyze });
    assert.deepEqual(calls, ['before', 'after']);
    assert.equal(result.confirmed, true);
    assert.equal(result.quality.slot, null, 'a refuted shallow mistake stays quiet');
    calls.length = 0;
    await confirmBadMove({ ...input, after: { score: 0, depth: 8 }, analyze });
    assert.equal(calls.length, 0);
});
test('verified bad moves retain their grade, reuse deep results and reject stale/incomplete evidence', async () => {
    let calls = 0;
    const strong = { before: { score: 0, depth: 12, bestmove: 'e2e4' }, after: { score: 200, depth: 12 } };
    const analyze = async () => { calls++; return { score: 200, depth: 12 }; };
    const result = await confirmBadMove({ ...input, ...strong, analyze });
    assert.equal(result.quality.slot, 'blunder_small'); assert.equal(calls, 0);
    assert.equal(await confirmBadMove({ ...input, analyze, isCurrent: () => false }), null);
    assert.equal(calls, 0);
    assert.equal(await confirmBadMove({ ...input, analyze: async () => ({ score: 0, depth: 8 }) }), null);
    let current = true;
    assert.equal(await confirmBadMove({ ...input, isCurrent: () => current, analyze: async () => { current = false; return strong.before; } }), null);
});
