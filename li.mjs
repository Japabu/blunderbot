import WebSocket from 'ws';

import { captureInfo, fullFen, higherPieceAttack, isEnPassant, isKnightFork } from "./board.mjs";
import { CheatDetector, clampScore, fetchAccount } from "./cheat.mjs";
import sf from "./sf.mjs";
import { GamePosition } from './hand-and-brain.mjs';
import { verifyBrilliant, verifyGreat } from './brilliant.mjs';


async function getGameInfo(gameId, playerName) {
    if (!gameId) throw new Error("gameId is required!");
    if (!playerName) throw new Error("playerName is required!");

    playerName = playerName.toLowerCase();

    const response = await fetch(`https://lichess.org/game/export/${gameId}?moves=true&pgnInJson=false&tags=false&clocks=false&evals=false&opening=false&division=false`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch game: ${response.status}`);
    }

    const game = await response.json();

    const { white, black } = game?.players ?? {};
    const opponentOf = side => ({ name: side?.user?.name ?? "anonymous", rating: side?.rating, speed: game.speed, clock: game.clock });
    const position = new GamePosition(game);
    const plies = position.valid ? position.ply : (game.moves?.trim().split(/\s+/).filter(Boolean).length ?? 0);

    if (playerName === white?.user?.name?.toLowerCase()) return { color: "w", opponent: opponentOf(black), plies, position };
    else if (playerName === black?.user?.name?.toLowerCase()) return { color: "b", opponent: opponentOf(white), plies, position };
    else throw new Error('Player not found in game');
};


function makeSri() {
    const length = 12;
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
        counter += 1;
    }
    return result;
}

let currentPlayerName = null;
let currentGameId = null;
let currentPlayerColor = null;
let prevMyScore = null;  // watched player's score after their previous move, null until one was seen
let prevPosition = null; // { ply, score, bestmove } of the last evaluated position, side-to-move POV
let prevClocks = null;   // { white, black } seconds left after the previous move
let prevBoard = null;    // board after the previous move
let checkStreak = { w: 0, b: 0 };   // consecutive checking moves per side
let queenTaken = null;              // { ply, white } of the last queen capture, to spot queen trades
let scrambled = false;              // time scramble already announced this game
let replayedUntil = 0;              // on connect Lichess replays recent moves; up to this ply they stay silent
let waitTimers = [];
let gamePosition = null;
let currentPosition = null;
let newestPly = 0;
let announcedResultGameId = null;
let lastSocketMessageAt = 0;
let lastPositionUpdateAt = 0;
let lastPositionCheckAt = 0;
const SOCKET_TIMEOUT_MS = 12000;
const POSITION_CHECK_MS = 15000;

// A long think first gets Komarov wondering what to play, then him asking for a move, then waiting music
// (at this share of the base time, but never before the hurry line had its turn)
const THINK_SECONDS = initial => initial < 180 ? 5 : initial < 600 ? 10 : 25;
const SLOW_SHARE = 0.15;
// Both clocks under this many seconds is a time scramble
const SCRAMBLE_SECONDS = 10;
let cheat = null;
let callbacks = {};
// Keep evaluations ordered, and share each position's search with hand-and-brain mode.
let evalQueue = Promise.resolve();
const evaluate = (fen, brain = false, multipv) => (evalQueue = evalQueue.catch(() => { }).then(async () => {
    const startedAt = performance.now();
    const result = await sf.evaluate(fen, { brain, ...(multipv ? { multipv } : {}) });
    return { ...result, startedAt, finishedAt: performance.now() };
}));

function setCurrentPosition(snapshot) {
    if (gamePosition?.ended || cheat?.finished) snapshot = null;
    if (snapshot && currentPosition?.gameId === currentGameId && currentPosition.ply === snapshot.ply && currentPosition.fen === snapshot.fen) return;
    currentPosition = snapshot ? { gameId: currentGameId, playerColor: currentPlayerColor, fen: snapshot.fen, ply: snapshot.ply } : null;
    callbacks.onPosition?.(currentPosition);
}

// Share searches, upgrading shallow commentary analysis when brain mode is enabled mid-turn.
function analyzePosition(position) {
    const brain = !!callbacks.wantsBrainCue?.() && position.fen.split(' ')[1] === currentPlayerColor;
    const multipv = !brain && callbacks.wantsGreat?.() && position.fen.split(' ')[1] === currentPlayerColor ? 2 : 1;
    if (!position.analysisPromise || (brain && !position.analysisForBrain) || (multipv === 2 && position.analysisMultiPv !== 2)) {
        position.analysisForBrain = brain;
        position.analysisMultiPv = multipv;
        position.analysis = null;
        const pending = evaluate(position.fen, brain, multipv === 2 ? 2 : undefined).then(result => {
            // Enabling brain mode can replace an in-flight shallow commentary search.
            if (position.analysisPromise === pending) {
                position.analysis = result;
                if (currentPosition === position) {
                    callbacks.onPositionAnalysis?.(position, result);
                }
            }
            return result;
        }).catch(error => {
            if (position.analysisPromise === pending) position.analysisPromise = null;
            throw error;
        });
        position.analysisPromise = pending;
    }
    return position.analysisPromise;
}

export function requestBrainCue() {
    const position = currentPosition;
    if (!callbacks.wantsBrainCue?.() || !position || position.fen.split(' ')[1] !== currentPlayerColor) return;
    callbacks.onPosition?.(position);
    if (position.analysis && position.analysisForBrain) callbacks.onPositionAnalysis?.(position, position.analysis);
    else void analyzePosition(position).catch(error => console.error('Brain analysis failed:', error));
}

// Profiling: when the move currently being voiced arrived from Lichess (performance.now() ms)
let lastMoveReceivedAt = null;
export const moveReceivedAt = () => lastMoveReceivedAt;

let interval = null;
let polling = false;
let ws = null;

// callbacks: onMove(), onMoveInstant({ ply, san, flavor }) as soon as a move arrives, before the engine,
// onMoveDelta(delta, { before, after, thinkTime, flavor, san }) for the watched player once it's evaluated,
// onMoment(moment), onCommentary("resign"/"draw"/"think"/"hurry") for results and long thinks,
// onGameStart(opponent), onCheatAlert(opponent, summary), onGameEnd(opponent, summary),
// onGameLoss()/onGameWin() once Lichess confirms a result, after invalidating piece cues
// onPosition(position|null) invalidates old brain cues immediately; onPositionAnalysis(position, result)
// is only emitted while that exact position is still current. wantsBrainCue() opts into opening searches.
// moment: "game_start", "en_passant" (either side), "stalemated" (the watched
// player stalemated the opponent), "promotion", "knight_promotion" (either side), "check_spam" (third check
// in a row by the watched player), "opponent_blunder", "you_slow", "opponent_slow",
// "time_scramble", or a flavor. Wins and losses, including checkmate, use result callbacks.
// flavor: what a move did on the board, no engine involved: "queen_trade", "lost_queen", "fork",
// "king_capture", or "attack_up".
// On the watched player's moves it comes with onMoveDelta so a real blunder can still win.
// onMoveDelta's info: before/after are the watched player's eval around the move, thinkTime in seconds or null
export async function watchPlayer(playerName, newCallbacks) {
    callbacks = newCallbacks;
    if (currentPlayerName?.toLowerCase() === playerName.toLowerCase()) return;

    // Drop the previous player's game, otherwise its moves keep making sounds until the new player starts a game
    closeGame();

    console.log("watching player: " + playerName);
    currentPlayerName = playerName;

    if (!interval) interval = setInterval(poll, 3000);
}

async function poll() {
    // A slow tick must not overlap the next one, or both would open a websocket to the same game
    if (!currentPlayerName || polling) return;
    polling = true;
    try {
        const polledPlayer = currentPlayerName;
        const response = await fetch(`https://lichess.org/api/users/status?ids=${encodeURIComponent(currentPlayerName)}&withGameIds=true`, {
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
        const body = await response.json();
        if (polledPlayer !== currentPlayerName) return;
        const gameId = body?.[0]?.playingId ?? null;
        callbacks.onGameActivity?.(!!gameId && !(gameId === currentGameId && cheat?.finished));

        if (!gameId) {
            if (currentGameId) closeGame();
            return;
        }

        // An open TCP connection can stop delivering game events. Lichess answers our pings with 0.
        if (ws && performance.now() - lastSocketMessageAt >= SOCKET_TIMEOUT_MS) {
            reconnectGame('heartbeat timed out');
        }

        // Recover even when the last move was dropped and no later move exposes the gap.
        const now = performance.now();
        const checkPosition = now - lastPositionUpdateAt >= SOCKET_TIMEOUT_MS && now - lastPositionCheckAt >= POSITION_CHECK_MS;
        if (gameId === currentGameId && (gamePosition?.needsSync || checkPosition) && ws?.readyState === WebSocket.OPEN) {
            lastPositionCheckAt = now;
            const playerName = currentPlayerName;
            const info = await getGameInfo(gameId, playerName);
            if (playerName !== currentPlayerName || gameId !== currentGameId) return;
            // Exports can lag behind the live socket. Never roll a healthy board back to cached history.
            if (info.position.valid && info.position.ply < newestPly) return;
            if (info.position.valid && (gamePosition?.needsSync || info.position.ply > newestPly || info.position.ended)) {
                console.log('Resynchronized game:', gameId, 'ply:', info.position.ply);
                gamePosition = info.position;
                newestPly = info.position.ply;
                replayedUntil = newestPly;
                clearWaitTimers();
                setCurrentPosition(gamePosition.current);
                if (gamePosition.ended) finishGame();
                else requestBrainCue();
            }
        }

        if (gameId !== currentGameId) {
            try { ws?.close(); } catch (ignored) { }
        }

        if (!ws || ws.readyState === WebSocket.CLOSED) {
            if (gameId !== currentGameId) finishGame();
            const playerName = currentPlayerName;
            let { color, opponent, plies, position } = await getGameInfo(gameId, playerName);
            if (playerName !== currentPlayerName) return;
            if (gameId === currentGameId && gamePosition?.valid && position.valid && position.ply < gamePosition.ply) {
                position = gamePosition;
                plies = position.ply;
            }
            currentGameId = gameId;
            currentPlayerColor = color;
            gamePosition = position;
            callbacks.onGameActivity?.(!position.ended);
            replayedUntil = plies;
            newestPly = plies;
            lastPositionUpdateAt = lastPositionCheckAt = performance.now();
            console.log("player color:", currentPlayerColor, "opponent:", opponent.name, "plies so far:", plies);
            if (!cheat || cheat.gameId !== gameId) {
                // Ring the bell as soon as the game is found, not when white gets around to the first move
                if (plies <= 1) moment("game_start");
                opponent.account = opponent.name === "anonymous" ? null : await fetchAccount(opponent.name);
                cheat = new CheatDetector(opponent);
                cheat.gameId = gameId;
                callbacks.onGameStart?.(opponent);
            }
            connectToGame(gameId);
            setCurrentPosition(position.valid ? position.current : null);
            requestBrainCue();
        }

        if (ws?.readyState === WebSocket.OPEN) {
            ws.send('p');
        }
        requestBrainCue();
    } catch (error) {
        console.error("Lichess poll error:", error);
    } finally {
        polling = false;
    }
}

function finishGame() {
    if (gamePosition) gamePosition.ended = true;
    setCurrentPosition(null);
    callbacks.onGameActivity?.(false);
    if (!cheat || cheat.finished) return;
    cheat.finished = true;
    callbacks.onGameEnd?.(cheat.opponent, cheat.summary());
}

function closeGame() {
    clearWaitTimers();
    finishGame();
    currentGameId = null;
    gamePosition = null;
    try { ws?.close(); } catch (ignored) { }
    ws = null;
}

function reconnectGame(reason) {
    console.log('Reconnecting game feed:', reason);
    clearWaitTimers();
    setCurrentPosition(null);
    const socket = ws;
    ws = null; // Ignore late messages and searches from the old connection immediately.
    socket?.terminate();
}

export function stopWatching() {
    closeGame();
    currentPlayerName = null;
}

export function getCurrentPlayerName() {
    return currentPlayerName;
}

export function latestMoveWasMine() {
    return !currentGameId || newestPly === 0 || (newestPly % 2 ? 'w' : 'b') === currentPlayerColor;
}

export async function searchPlayers(term) {
    if (!term || term.length < 3) {
        return [];
    }

    try {
        const response = await fetch(`https://lichess.org/api/player/autocomplete?term=${encodeURIComponent(term)}&names=true`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const usernames = await response.json();
        return usernames.slice(0, 25); // Limit to Discord's 25 choice maximum
    } catch (error) {
        console.error('Lichess player search error:', error);
        return [];
    }
}

function connectToGame(gameId) {
    console.log("connecting to game: " + gameId);

    prevMyScore = null;
    prevPosition = null;
    prevClocks = null;
    prevBoard = null;
    checkStreak = { w: 0, b: 0 };
    queenTaken = null;
    scrambled = false;
    clearWaitTimers();

    const sri = makeSri();
    ws = new WebSocket(`wss://socket5.lichess.org/watch/${gameId}/white/v6?sri=${sri}`, {
        headers: {
            origin: "https://lichess.org"
        }
    });
    const socket = ws;
    lastSocketMessageAt = performance.now();

    ws.on('error', console.error);

    ws.on('message', async (data) => {
        const receivedAt = performance.now();
        if (socket === ws) lastSocketMessageAt = receivedAt;
        try {
            await handleMessage(gameId, JSON.parse(data), receivedAt, socket);
        } catch (error) {
            console.error("Game message error:", error);
        }
    });
}

async function handleMessage(gameId, body, receivedAt, socket) {
    if (!body || gameId !== currentGameId || socket !== ws) return;

    // console.log("MESSAGE:", body);

    const messageType = body.t;
    if (messageType === 'batch') {
        if (Array.isArray(body.d)) await Promise.all(body.d.map(message => handleMessage(gameId, message, receivedAt, socket)));
        return;
    }
    if (messageType === 'resync' || messageType === 'reload') {
        reconnectGame(messageType);
        return;
    }
    if (messageType === "endData" || messageType === "end") {
        const { winner, status } = body.d ?? {};
        const myColor = currentPlayerColor === "w" ? "white" : "black";
        // A bare end can precede the detailed result. Do not let finishing the game swallow that result.
        const result = winner && announcedResultGameId !== gameId ? (winner === myColor ? 'win' : 'loss') : null;
        clearWaitTimers();
        if (cheat && !cheat.finished) {
            if (!winner && ["draw", "stalemate"].includes(status?.name)) callbacks.onCommentary?.("draw");
        }
        finishGame();
        if (result) {
            announcedResultGameId = gameId;
            if (result === 'win') callbacks.onGameWin?.();
            else callbacks.onGameLoss?.();
        }
        return;
    }
    if (messageType !== "move") return;

    const { fen, ply, uci, san, clock } = body.d ?? {};
    lastPositionUpdateAt = receivedAt;
    newestPly = Math.max(newestPly, ply);
    const replayed = ply <= replayedUntil;
    const tracked = gamePosition?.observe({ fen, ply, san });
    if (!replayed) callbacks.onMove?.({ gameId, ply, piece: tracked?.move?.piece });
    if (!gamePosition?.valid) setCurrentPosition(null);
    else if (tracked?.ply === newestPly && !cheat?.finished) setCurrentPosition(tracked);

    // turn = side to move now, lastTurn = side that just moved
    const turn = ply % 2 === 0 ? "w" : "b";
    const lastTurn = ply % 2 !== 0 ? "w" : "b";
    const mine = lastTurn === currentPlayerColor;

    const initial = cheat?.opponent.clock?.initial;
    watchThinkTime(gameId, ply, turn, initial);
    if (!replayed && clock && initial >= 60 && !scrambled && clock.white < SCRAMBLE_SECONDS && clock.black < SCRAMBLE_SECONDS) {
        scrambled = true;
        moment("time_scramble");
    }

    // Think time of the move just played; the clock after a move already includes the increment
    const moverClock = lastTurn === "w" ? "white" : "black";
    const increment = cheat?.opponent.clock?.increment ?? 0;
    const thinkTime = clock && prevClocks ? prevClocks[moverClock] - clock[moverClock] + increment : null;
    const clockBefore = prevClocks?.[moverClock];
    if (clock) prevClocks = clock;

    const enPassant = isEnPassant(prevBoard, fen, uci);
    const capture = captureInfo(prevBoard, uci, enPassant);
    const flavor = boardFlavor(prevBoard, fen, uci, capture, ply, lastTurn, mine);
    prevBoard = fen;

    checkStreak[lastTurn] = san?.includes("+") ? checkStreak[lastTurn] + 1 : 0;

    // Everything readable off the board plays right away; the engine only gets a say once it's done
    const promotion = uci?.length === 5 ? uci[4] : null;
    const attackFlavor = !replayed && higherPieceAttack(
        gamePosition?.snapshots.get(ply - 1)?.fen, tracked?.fen, lastTurn, tracked?.move?.from, tracked?.move?.to);
    const moveFlavor =
        attackFlavor === 'discovery' ? attackFlavor :
        enPassant ? "en_passant" :
        promotion === "n" ? "knight_promotion" :
        promotion ? "promotion" :
        tracked?.move?.isKingsideCastle() || tracked?.move?.isQueensideCastle() ? 'castle' :
        checkStreak[lastTurn] === 3 ? "check_spam" :
        flavor === 'fork' ? 'fork' :
        attackFlavor ? attackFlavor :
        flavor;
    const mate = san?.includes("#");
    if (!replayed) {
        lastMoveReceivedAt = receivedAt;
        // The confirmed result will play one victory/loss clip; do not start a second one here.
        if (!mate) callbacks.onMoveInstant?.({ ply, san, flavor: moveFlavor, mine });
    }

    // Replayed old moves only update the board state; the newest one is still evaluated so the next move
    // has something to compare against
    if (replayed && ply < replayedUntil) return;

    // Evaluate every position: the score scores the move just played, the best move judges the next one
    const position = currentPosition?.ply === ply ? currentPosition : null;
    const { score, bestmove, depth, variations, startedAt, finishedAt } = await (position ? analyzePosition(position) : evaluate(tracked?.fen ?? fullFen(fen, turn, uci)));
    if (gameId !== currentGameId || socket !== ws) return;
    console.log(`[timing] ply ${ply} ${lastTurn}: queued ${Math.round(startedAt - receivedAt)} ms, eval ${Math.round(finishedAt - startedAt)} ms, decided at +${Math.round(performance.now() - receivedAt)} ms`);

    // Mate scores are ±1e9, clamp them so a mating sequence isn't a million-centipawn swing per move
    const moverScore = clampScore(-score);
    const before = prevPosition?.ply === ply - 1 ? prevPosition : null;
    prevPosition = { ply, score, bestmove, depth, variations };

    // The engine adds stalemate (no legal moves without check) and the watched player's good/bad verdict.
    // Checkmate waits for the confirmed result instead of starting a second reaction here.
    const stalemate = bestmove === "(none)" && score >= 0;
    if (replayed || mate) {
        // Nothing to add: before our time, or the game is over anyway
    } else if (stalemate) {
        if (mine) moment("stalemated");
    } else if (mine) {
        const moveDelta = before ? moverScore - clampScore(before.score) : null;
        let brilliant = null;
        let great = null;
        if (before && (callbacks.wantsBrilliant?.() || callbacks.wantsGreat?.()) && tracked?.fen) {
            try {
                const searches = new Map();
                const options = {
                    beforeFen: gamePosition?.snapshots.get(ply - 1)?.fen, afterFen: tracked.fen, uci,
                    analyze: (fen, { multipv } = {}) => {
                        const key = fen + ':' + (multipv ?? 1);
                        if (!searches.has(key)) searches.set(key, evaluate(fen, true, multipv));
                        return searches.get(key);
                    },
                    isCurrent: () => gameId === currentGameId && socket === ws && ply === newestPly && !cheat?.finished,
                };
                if (callbacks.wantsBrilliant?.()) brilliant = await verifyBrilliant({ ...options, isCurrent: () => options.isCurrent() && !!callbacks.wantsBrilliant?.() });
                if (!brilliant && callbacks.wantsGreat?.()) great = await verifyGreat({ ...options, baseline: before, isCurrent: () => options.isCurrent() && !!callbacks.wantsGreat?.() });
            } catch (error) { console.error('Tactical verification failed:', error.message); }
        }
        console.log(`Player ${lastTurn} moved, delta: ${moveDelta}, think time: ${thinkTime?.toFixed(2)}, flavor: ${moveFlavor}`);
        if (ply === newestPly && !cheat?.finished) {
            callbacks.onMoveDelta?.(moveDelta, { before: before ? clampScore(before.score) : null, after: moverScore, thinkTime, flavor: moveFlavor, san, uci, bestmove: before?.bestmove, brilliant, great });
        }
    }
    if (mine) prevMyScore = moverScore;

    if (!replayed && !mine && before && cheat && !cheat.finished) {
        cheat.record({ ply, uci, before: before.score, bestmove: before.bestmove, after: moverScore, thinkTime, clockBefore });
        if (cheat.shouldAlert()) callbacks.onCheatAlert?.(cheat.opponent, cheat.summary());
    }
}

function moment(name) {
    console.log("Moment:", name);
    callbacks.onMoment?.(name);
}

// What the move did on the board, most remarkable first. Retains the last queen capture for trades.
function boardFlavor(prevBoard, board, uci, capture, ply, lastTurn, mine) {
    if (!prevBoard) return null;

    let queenFlavor = null;
    if (capture?.captured === "q") {
        const white = lastTurn !== "w"; // the captured queen's color
        queenFlavor = queenTaken?.ply === ply - 1 && queenTaken.white !== white ? "queen_trade" : !mine ? "lost_queen" : null;
        queenTaken = { ply, white };
    }

    if (queenFlavor) return queenFlavor;
    if (isKnightFork(board, uci)) return "fork";
    if (!capture) return null;
    if (capture.capturer === "k") return "king_capture";
    return 'capture';
}

// Komarov and then waiting music when the side to move takes too long; the next move cancels it all
function watchThinkTime(gameId, ply, turn, initial) {
    clearWaitTimers();
    // The clock only starts once both sides made their first move
    if (ply < 2 || !initial) return;
    const think = THINK_SECONDS(initial);
    const stillThinking = () => gameId === currentGameId && !cheat?.finished;
    const after = (seconds, fn) => waitTimers.push(setTimeout(() => stillThinking() && fn(), seconds * 1000));
    after(think, () => callbacks.onCommentary?.("think"));
    after(think * 2, () => callbacks.onCommentary?.("hurry"));
    after(Math.max(think * 2 + 5, initial * SLOW_SHARE), () => moment(turn === currentPlayerColor ? "you_slow" : "opponent_slow"));
}

function clearWaitTimers() {
    waitTimers.forEach(clearTimeout);
    waitTimers = [];
}
