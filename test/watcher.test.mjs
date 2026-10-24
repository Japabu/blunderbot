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
    let gameId = 'brain-test', initialFen, playerColor = 'w', clockInitial = 0, exportStatus = 'started', exportWinner;
    const queenAttacked = 'r4k1r/pbp2p2/2p1pp2/6bp/2BqR3/P1NP2N1/1PP2PPP/R2Q2K1 b - - 10 16';
    let exportedMoves;
    let playing = true;
    mock.method(globalThis, 'fetch', async input => {
        const url = String(input);
        if (url.includes('/api/users/status')) return Response.json([{ playingId: playing ? gameId : undefined }]);
        if (url.includes('/game/export/')) return Response.json({
            moves: exportedMoves ?? gameMoves, initialFen, variant: initialFen ? 'fromPosition' : 'standard', status: exportStatus, winner: exportWinner, speed: 'blitz', clock: { initial: clockInitial, increment: 0 },
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
    const losses = [], wins = [];
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
        onMoveDelta: (delta, info) => deltas.push({ ...info, delta }),
        onGameLoss: () => losses.push({ gameId, brainPosition: brain.position }),
        onGameWin: () => wins.push({ gameId, brainPosition: brain.position }),
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
    assert.equal(deltas.at(-1).delta, -40, 'compare the adjacent before/after positions, not the previous own move');
    assert.equal(deltas.at(-1).bestmove.length >= 4, true);
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
        for (const ending of ['mate', 'resign', 'outoftime', 'timeout', 'draw', 'aborted', 'win-mate', 'win-resign', 'win-outoftime', 'win-timeout']) {
            stopWatching();
            gameId = `result-${color}-${ending}`; initialFen = undefined; playerColor = color;
            gameMoves = color === 'w' ? 'e4 e5' : 'e4';
            enabled = true;
            await watchPlayer('hand', callbacks); await tick(); await flush();
            socket = globalThis.brainTestSocket;
            assert.equal(latestMoveWasMine(), false, 'the result follows an opponent move');
            const beforeLoss = losses.length;
            const beforeWin = wins.length;
            const isWin = ending.startsWith('win-');
            const opponentColor = color === 'w' ? 'black' : 'white';
            const winner = ['draw', 'aborted'].includes(ending) ? undefined
                : isWin ? (color === 'w' ? 'white' : 'black') : opponentColor;
            const result = { winner, status: { name: ending.replace(/^win-/, '') } };
            if (ending.endsWith('mate')) await emit({ t: 'end' }); // Details can arrive after the game has stopped.
            await emit({ t: 'endData', d: result });
            await emit({ t: 'end', d: result });
            const isLoss = !['draw', 'aborted'].includes(ending) && !isWin;
            assert.equal(losses.length - beforeLoss, isLoss ? 1 : 0, `${color} ${ending}: announce a loss only once`);
            assert.equal(wins.length - beforeWin, isWin ? 1 : 0, `${color} ${ending}: announce a win only once`);
            if (isLoss) assert.equal(losses.at(-1).brainPosition, null, 'cancel piece cues before the loss sound');
            if (isWin) assert.equal(wins.at(-1).brainPosition, null, 'cancel piece cues before the win sound');
        }
    }

    stopWatching();
    gameId = 'live-checkmate'; initialFen = undefined; playerColor = 'b'; gameMoves = 'f3 e5 g4';
    await watchPlayer('hand', callbacks); await tick(); await flush();
    socket = globalThis.brainTestSocket;
    const matingBoard = new Chess();
    for (const san of gameMoves.split(' ')) matingBoard.move(san);
    const mate = matingBoard.move('Qh4#');
    const beforeInstant = instant.length, beforeWin = wins.length;
    await emit({ t: 'move', d: { fen: matingBoard.fen().split(' ')[0], ply: 4, san: mate.san, uci: mate.lan } });
    assert.equal(instant.length, beforeInstant, 'mate must not start another sound before the confirmed result');
    await emit({ t: 'endData', d: { winner: 'black', status: { name: 'mate' } } });
    assert.equal(wins.length - beforeWin, 1);

    stopWatching();
    gameId = 'pawn-threat'; playerColor = 'w'; gameMoves = '';
    initialFen = '4k3/8/8/3q4/8/4P3/8/4K3 w - - 0 1';
    await watchPlayer('hand', callbacks); await tick(); await flush();
    socket = globalThis.brainTestSocket;
    const threatBoard = new Chess(initialFen);
    for (const [i, san] of ['e4', 'Kf8', 'Kf2'].entries()) {
        const moved = threatBoard.move(san);
        await emit({ t: 'move', d: { fen: threatBoard.fen().split(' ')[0], ply: i + 1, san: moved.san, uci: moved.lan } });
        assert.equal(instant.at(-1).flavor === 'attack_up', i === 0, 'only the newly created own threat triggers');
    }

    stopWatching();
    gameId = 'opponent-pawn-threat'; playerColor = 'w'; gameMoves = '';
    initialFen = '4k3/8/4p3/8/3Q4/8/8/K7 b - - 0 1';
    await watchPlayer('hand', callbacks); await tick(); await flush();
    socket = globalThis.brainTestSocket;
    const opponentBoard = new Chess(initialFen);
    const opponentMove = opponentBoard.move('e5');
    await emit({ t: 'move', d: { fen: opponentBoard.fen().split(' ')[0], ply: 2, san: opponentMove.san, uci: opponentMove.lan } });
    assert.equal(instant.at(-1).mine, false);
    assert.equal(instant.at(-1).flavor, 'attack_up', 'opponent special moves are detected for independently configured sound rules');

    stopWatching();
    gameId = 'missing-result'; playerColor = 'w'; initialFen = undefined; gameMoves = 'e4 e5';
    await watchPlayer('hand', callbacks); await tick(); await flush(); socket = globalThis.brainTestSocket;
    playing = false;
    await tick(); await flush();
    assert.equal(socket.readyState, 1, 'a transient missing playingId must not close a live game');
    const priorWins = wins.length;
    exportStatus = 'outoftime'; exportWinner = 'white';
    await tick(); await flush();
    assert.equal(wins.length, priorWins + 1, 'recover a confirmed timeout win without any endData message');
    assert.equal(socket.readyState, 3);
    await tick(); assert.equal(wins.length, priorWins + 1, 'the recovered result plays once');
    playing = true; exportStatus = 'started'; exportWinner = undefined;

    stopWatching();
    gameId = 'waiting-both-players'; playerColor = 'w'; initialFen = undefined; gameMoves = 'e4 e5'; clockInitial = 180;
    const moments = [];
    mock.timers.enable({ apis: ['setTimeout'] });
    t.after(() => mock.timers.reset());
    await watchPlayer('hand', { ...callbacks, onMoment: name => moments.push(name) });
    await tick(); await flush(); socket = globalThis.brainTestSocket;
    const timedBoard = new Chess(); timedBoard.move('e4'); timedBoard.move('e5');
    const timedMove = async (san, ply) => {
        const move = timedBoard.move(san);
        await emit({ t: 'move', d: { fen: timedBoard.fen().split(' ')[0], ply, san: move.san, uci: move.lan } });
    };
    await timedMove('Nf3', 3);
    mock.timers.tick(2999); assert.deepEqual(moments, []);
    mock.timers.tick(1); assert.deepEqual(moments, ['opponent_slow']);
    await timedMove('Nc6', 4);
    mock.timers.tick(3000); assert.deepEqual(moments, ['opponent_slow', 'you_slow']);
    await timedMove('Bc4', 5);
    mock.timers.tick(2000); await timedMove('Bc5', 6);
    mock.timers.tick(1000); assert.equal(moments.length, 2, 'a move cancels the previous waiting timer');
    stopWatching(); mock.timers.tick(2000); assert.equal(moments.length, 2, 'stopping cancels all waiting sounds');
});
