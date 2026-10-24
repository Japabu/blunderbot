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
            constructor() { super(); this.readyState = 1; this.sent = []; globalThis.brainTestSocket = this; }
            send(data) { this.sent.push(data); }
            close() { this.readyState = 3; }
            terminate() { this.close(); }
        }
    `;
    const hooks = registerHooks({ resolve(specifier, context, next) {
        if (specifier === 'ws') return { url: 'data:text/javascript,' + encodeURIComponent(fakeSocket), shortCircuit: true };
        return next(specifier, context);
    } });
    let tick;
    let now = 0;
    mock.method(performance, 'now', () => now);
    mock.method(globalThis, 'setInterval', fn => { tick = fn; return 1; });
    let gameMoves = '';
    let gameId = 'brain-test', initialFen, playerColor = 'w';
    const queenAttacked = 'r4k1r/pbp2p2/2p1pp2/6bp/2BqR3/P1NP2N1/1PP2PPP/R2Q2K1 b - - 10 16';
    let exportedMoves;
    let playing = true;
    mock.method(globalThis, 'fetch', async input => {
        const url = String(input);
        if (url.includes('/api/users/status')) return Response.json([{ playingId: playing ? gameId : undefined }]);
        if (url.includes('/game/export/')) return Response.json({
            moves: exportedMoves ?? gameMoves, initialFen, variant: initialFen ? 'fromPosition' : 'standard', status: 'started', speed: 'blitz', clock: { initial: 0, increment: 0 },
            players: {
                [playerColor === 'w' ? 'white' : 'black']: { user: { name: 'hand' }, rating: 1500 },
                [playerColor === 'w' ? 'black' : 'white']: { aiLevel: 3 },
            },
        });
        throw Error('Unexpected fetch: ' + url);
    });
    const searches = [];
    let holdNext = false, release;
    mock.method(sf, 'evaluate', async (fen, { brain = false } = {}) => {
        const board = new Chess(fen);
        const moves = board.moves({ verbose: true });
        const selected = moves.find(move => move.lan === 'g1f3') ?? moves.find(move => move.piece === 'p') ?? moves[0];
        searches.push({ fen, brain });
        if (holdNext) {
            holdNext = false;
            await new Promise(resolve => { release = resolve; });
        }
        // Results reproduced on the Pi for YrMa2KBQ after 16.Re4: depth 8 picks c5,
        // while depths 12, 14 and 16 choose Qd8 to save the attacked queen.
        const bestmove = fen === queenAttacked ? (brain ? 'd4d8' : 'c6c5') : selected?.lan ?? '(none)';
        return { score: 20, depth: brain ? 12 : 8, bestmove };
    });
    const { watchPlayer, stopWatching, requestBrainCue, latestMoveWasMine } = await import('../li.mjs');
    const spoken = [];
    const activity = [];
    const instant = [], deltas = [];
    const losses = [];
    let enabled = true;
    const brain = new HandAndBrain({ enabled: () => enabled, speak: piece => spoken.push(piece) });
    t.after(() => { stopWatching(); hooks.deregister(); mock.restoreAll(); delete globalThis.brainTestSocket; });
    const flush = () => new Promise(setImmediate);
    const callbacks = {
        wantsBrainCue: () => enabled,
        onGameActivity: active => activity.push(active),
        onPosition: position => brain.setPosition(position),
        onPositionAnalysis: (position, result) => brain.analyzed(position, result),
        onMove: move => brain.moved(move),
        onMoveInstant: move => instant.push(move),
        onMoveDelta: (delta, info) => deltas.push(info),
        onGameLoss: () => losses.push({ gameId, brainPosition: brain.position }),
    };
    await watchPlayer('hand', callbacks);
    await tick(); await flush();
    assert.deepEqual(spoken, ['knight'], 'White must get a cue before making the first move');
    assert.equal(searches.length, 1, 'initial polling must share a single search');
    assert.equal(activity.at(-1), true, 'status polling must suspend idle disconnect during an active game');
    assert.equal(searches[0].brain, true, 'piece cues must use stronger searches');
    let socket = globalThis.brainTestSocket;
    assert.equal(socket.sent.at(-1), 'p', 'send the Lichess heartbeat instead of null');
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
    assert.equal(instant.at(-1).mine, true);
    assert.equal(latestMoveWasMine(), true);
    assert.deepEqual(spoken, ['knight'], 'do not give a cue on the opponent turn');
    await move('Nf6');
    assert.equal(instant.at(-1).mine, false);
    assert.equal(latestMoveWasMine(), false);
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

    // A missed final update must recover without needing a later move to expose the gap.
    exportedMoves = gameMoves;
    await move('a3');
    await move('a6', false);
    now += 15000;
    await emit(0); // Pongs keep the connection alive, but must not hide lost moves.
    await tick(); await flush();
    assert.equal(brain.position.ply, 7, 'a delayed export must never rewind the live board');
    exportedMoves = undefined;
    now += 15000;
    await emit(0); await tick(); await flush();
    assert.equal(brain.position.ply, 8, 'recover a lost move even while pongs still arrive');
    assert.ok(brain.piece, 'speech must resume after recovering the missing opponent move');

    const batch = [];
    for (const san of ['b3', 'b6']) {
        const result = board.move(san); ply++;
        gameMoves += ' ' + san;
        batch.push({ t: 'move', d: { fen: board.fen().split(' ')[0], ply, uci: result.lan, san } });
    }
    await emit({ t: 'batch', d: batch });
    assert.equal(brain.position.ply, 10, 'batched moves must reach the brain');
    assert.ok(brain.piece);

    await emit({ t: 'resync' });
    assert.equal(brain.position, null, 'a server resync invalidates the old cue immediately');
    assert.equal(socket.readyState, 3);
    exportedMoves = gameMoves.split(' ').slice(0, -2).join(' ');
    await tick(); await flush();
    assert.notEqual(globalThis.brainTestSocket, socket);
    socket = globalThis.brainTestSocket;
    assert.equal(brain.position.ply, 10, 'reconnecting must also reject a cached export behind the live board');
    exportedMoves = undefined;
    assert.ok(brain.piece, 'reconnecting must resume the current cue');

    now += 12000;
    await tick(); await flush();
    assert.equal(socket.readyState, 3, 'an open socket without heartbeats must be replaced');
    assert.notEqual(globalThis.brainTestSocket, socket);
    socket = globalThis.brainTestSocket;
    assert.ok(brain.piece);

    holdNext = true;
    const slowOwn = move('g3');
    await flush();
    const fastOpponent = move('g6');
    const fastOwn = move('h3');
    const beforeDelayed = deltas.length;
    release();
    await Promise.all([slowOwn, fastOpponent, fastOwn]); await flush();
    assert.deepEqual(deltas.slice(beforeDelayed).map(info => info.san), ['h3'],
        'late analysis must never play an earlier move reaction over newer moves');
    assert.ok(brain.position, 'turn tracking must preserve hand-and-brain cues');
    holdNext = true;
    const pendingMove = move('h6');
    await flush();
    assert.equal(typeof release, 'function');
    const beforeEnd = spoken.length;
    await emit({ t: 'endData', d: { winner: 'white', status: { name: 'resign' } } });
    assert.equal(activity.at(-1), false, 'game end must start the idle countdown');
    release(); await pendingMove; await flush();
    assert.equal(brain.position, null);
    assert.equal(spoken.length, beforeEnd, 'a search completing after game end must stay silent');
    playing = false;
    await tick();
    assert.equal(socket.readyState, 3, 'status polling must close the finished game socket');

    // Regression for the user's reported queen attack, including enabling mid-search.
    stopWatching();
    gameId = 'queen-attack'; initialFen = queenAttacked; playerColor = 'b';
    gameMoves = ''; playing = true; enabled = false;
    await watchPlayer('hand', callbacks);
    await tick(); await flush();
    socket = globalThis.brainTestSocket;
    holdNext = true;
    const shallow = emit({ t: 'move', d: { fen: queenAttacked.split(' ')[0], ply: 31, san: 'Re4', uci: 'e1e4' } });
    await flush();
    enabled = true;
    const beforeUpgrade = spoken.length;
    requestBrainCue();
    release(); await shallow; await flush();
    assert.deepEqual(spoken.slice(beforeUpgrade), ['queen'], 'a shallow pawn result must not escape while upgrading the search');
    assert.deepEqual(searches.slice(-2).map(search => search.brain), [false, true]);
    const afterUpgrade = searches.length;
    requestBrainCue(); await flush();
    assert.equal(searches.length, afterUpgrade, 'reuse the stronger result for the same position');

    for (const color of ['w', 'b']) {
        for (const ending of ['mate', 'resign', 'outoftime', 'timeout', 'draw', 'aborted', 'win']) {
            stopWatching();
            gameId = `result-${color}-${ending}`; initialFen = undefined; playerColor = color;
            gameMoves = color === 'w' ? 'e4 e5' : 'e4';
            enabled = true;
            await watchPlayer('hand', callbacks); await tick(); await flush();
            socket = globalThis.brainTestSocket;
            assert.equal(latestMoveWasMine(), false, 'the result follows an opponent move');
            const beforeLoss = losses.length;
            const opponentColor = color === 'w' ? 'black' : 'white';
            const winner = ['draw', 'aborted'].includes(ending) ? undefined
                : ending === 'win' ? (color === 'w' ? 'white' : 'black') : opponentColor;
            const result = { winner, status: { name: ending === 'win' ? 'mate' : ending } };
            if (ending === 'mate') await emit({ t: 'end' }); // Details can arrive after the game has stopped.
            await emit({ t: 'endData', d: result });
            await emit({ t: 'end', d: result });
            const isLoss = !['draw', 'aborted', 'win'].includes(ending);
            assert.equal(losses.length - beforeLoss, isLoss ? 1 : 0, `${color} ${ending}: announce a loss only once`);
            if (isLoss) assert.equal(losses.at(-1).brainPosition, null, 'cancel piece cues before the loss sound');
        }
    }
});
