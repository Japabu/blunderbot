import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sf from '../sf.mjs';

test('ponder controls reach the service in order and failures do not block later searches', async t => {
    const previous = process.env.STOCKFISH_SERVER_URL;
    process.env.STOCKFISH_SERVER_URL = 'http://engine.test/';
    t.after(() => {
        mock.restoreAll();
        if (previous === undefined) delete process.env.STOCKFISH_SERVER_URL;
        else process.env.STOCKFISH_SERVER_URL = previous;
    });
    const calls = [];
    mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, options });
        if (options.method === 'POST') return new Response('unavailable', { status: 503 });
        if (options.method === 'DELETE') return Response.json({ pondering: false });
        return Response.json({ bestmove: 'g1f3', score: 25, depth: 14, ponderHit: true });
    });
    await assert.rejects(sf.startPonder('expected fen'), /503/);
    await sf.stopPonder();
    const result = await sf.evaluate('actual fen', { brain: true });
    assert.equal(result.ponderHit, true);
    assert.deepEqual(calls.map(({ options }) => options.method), ['POST', 'DELETE', undefined]);
    assert.equal(calls[0].url, 'http://engine.test/ponder');
    assert.deepEqual(JSON.parse(calls[0].options.body), { fen: 'expected fen' });
});

test('brain searches go deeper than normal commentary searches', async t => {
    t.after(() => mock.restoreAll());
    const depths = [];
    mock.method(globalThis, 'fetch', async url => {
        const depth = Number(new URL(url, 'http://engine.test/').searchParams.get('depth'));
        depths.push(depth);
        return Response.json({ bestmove: 'd4d8', score: -417, depth });
    });
    const fen = 'r4k1r/pbp2p2/2p1pp2/6bp/2BqR3/P1NP2N1/1PP2PPP/R2Q2K1 b - - 10 16';
    await sf.evaluate(fen);
    const result = await sf.evaluate(fen, { brain: true });
    assert.deepEqual(depths, [8, 12]);
    assert.equal(result.bestmove, 'd4d8');
});

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
