import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sf from '../sf.mjs';

test('terminal engine results at depth zero remain valid for game-end commentary', async t => {
    t.after(() => mock.restoreAll());
    let result;
    mock.method(globalThis, 'fetch', async () => Response.json(result));
    for (result of [
        { bestmove: '(none)', score: 0, depth: 0 },
        { bestmove: '(none)', score: -1_000_000_000, depth: 0 },
        { bestmove: '0000', score: 0, depth: 0 },
        { bestmove: 'e2e4', score: 26, depth: 8 },
    ]) assert.deepEqual(await sf.evaluate('test'), result);
});

test('a move without completed analysis and malformed engine results are rejected', async t => {
    t.after(() => mock.restoreAll());
    let result;
    mock.method(globalThis, 'fetch', async () => Response.json(result));
    for (result of [
        { bestmove: 'e2e4', score: 26, depth: 0 },
        { bestmove: '(none)', score: 0, depth: -1 },
        { bestmove: 'e2e4', score: '26', depth: 8 },
        { error: 'Engine failed' },
    ]) await assert.rejects(sf.evaluate('test'), /Invalid Stockfish analysis/);
});

test('HTTP engine failures do not become move-quality evaluations', async t => {
    t.after(() => mock.restoreAll());
    mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
    await assert.rejects(sf.evaluate('test'), /Stockfish request failed: 503/);
});
