import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Chess } from 'chess.js';
import { HandAndBrain, pieceForBestMove } from '../hand-and-brain.mjs';
import sf from '../sf.mjs';

// Exercise the actual watcher without connecting to Discord or a real Lichess game.
test('the watcher supplies initial, live and resynchronized cues and suppresses stale searches', async t => {
    const fakeSocket = `
        import { EventEmitter } from 'node:events';
        export default class FakeSocket extends EventEmitter {
            static OPEN = 1; static CLOSED = 3;
            constructor() { super(); this.readyState = 1; globalThis.brainTestSocket = this; }
            send() {}
            close() { this.readyState = 3; }
        }
    `;
    const hooks = registerHooks({ resolve(specifier, context, next) {
        if (specifier === 'ws') return { url: 'data:text/javascript,' + encodeURIComponent(fakeSocket), shortCircuit: true };
        return next(specifier, context);
    } });
    let tick;
    mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; });
    let gameMoves = '';
    mock.method(globalThis, 'fetch', async input => {
        const url = String(input);
        if (url.includes('/api/users/status')) return Response.json([{ playingId: 'brain-test' }]);
        if (url.includes('/game/export/')) return Response.json({
            moves: gameMoves, variant: 'standard', status: 'started', speed: 'blitz', clock: { initial: 0, increment: 0 },
            players: { white: { user: { name: 'hand' }, rating: 1500 }, black: { aiLevel: 3 } },
        });
        throw Error('Unexpected fetch: ' + url);
    });
    const searches = [];
    let holdNext = false, release;
    mock.method(sf, 'evaluate', async fen => {
        const board = new Chess(fen);
        const moves = board.moves({ verbose: true });
        const selected = moves.find(move => move.lan === 'g1f3') ?? moves.find(move => move.piece === 'p') ?? moves[0];
        searches.push(fen);
        if (holdNext) {
            holdNext = false;
            await new Promise(resolve => { release = resolve; });
        }
        return { score: 20, depth: 8, bestmove: selected?.lan ?? '(none)' };
    });
    const { watchPlayer, stopWatching, requestBrainCue } = await import('../li.mjs');
    const spoken = [];
    let enabled = true;
    const brain = new HandAndBrain({ enabled: () => enabled, speak: piece => spoken.push(piece) });
    t.after(() => { stopWatching(); hooks.deregister(); mock.restoreAll(); delete globalThis.brainTestSocket; });
    const flush = () => new Promise(setImmediate);
    await watchPlayer('hand', {
        wantsBrainCue: () => enabled,
        onPosition: position => brain.setPosition(position),
        onPositionAnalysis: (position, result) => brain.analyzed(position, result),
        onMove: move => brain.moved(move),
    });
    await tick(); await flush();
    assert.deepEqual(spoken, ['knight'], 'White must get a cue before making the first move');
    assert.equal(searches.length, 1, 'initial polling must share a single search');
    const socket = globalThis.brainTestSocket;
    const board = new Chess();
    let ply = 0;
    async function emit(body) {
        for (const listener of socket.listeners('message')) await listener(Buffer.from(JSON.stringify(body)));
    }
    async function move(san, send = true) {
        const result = board.move(san); ply++;
        gameMoves += (gameMoves ? ' ' : '') + san;
        if (send) await emit({ t: 'move', d: { fen: board.fen().split(' ')[0], ply, uci: result.lan, san } });
    }
    await move('Nf3');
    assert.deepEqual(spoken, ['knight'], 'do not give a cue on the opponent turn');
    await move('Nf6');
    assert.equal(spoken.length, 2);
    assert.equal(spoken.at(-1), pieceForBestMove(board.fen(), board.moves({ verbose: true }).find(move => move.piece === 'p').lan));
    await move('Nc3');
    assert.equal(spoken.at(-1), 'wrong_piece');

    await move('Nc6', false); // Simulate losing one websocket update.
    await move('e4');
    assert.equal(brain.position, null, 'a move gap must invalidate the cue');
    await tick(); await flush();
    assert.ok(brain.position, 'polling must recover the exact position from the export');
    await move('e5');
    assert.equal(brain.position.ply, 6);
    const count = searches.length;
    enabled = false; brain.reset(); requestBrainCue(); await flush();
    enabled = true; requestBrainCue(); await flush();
    assert.equal(searches.length, count, 'enabling mid-turn should reuse existing analysis');
    assert.equal(brain.position.ply, 6);

    await move('a3'); // Black to move: no piece cue.
    holdNext = true;
    const pendingMove = move('a6');
    await flush();
    assert.equal(typeof release, 'function');
    const beforeEnd = spoken.length;
    await emit({ t: 'endData', d: { winner: 'white', status: { name: 'resign' } } });
    release(); await pendingMove; await flush();
    assert.equal(brain.position, null);
    assert.equal(spoken.length, beforeEnd, 'a search completing after game end must stay silent');
});
