import WebSocket from 'ws';

import { captureInfo, fullFen, isEnPassant, isKnightFork, isSnipe, pieceCount } from "./board.mjs";
import { CheatDetector, clampScore, fetchAccount } from "./cheat.mjs";
import sf from "./sf.mjs";


async function getGameInfo(gameId, playerName) {
    if (!gameId) throw new Error("gameId is required!");
    if (!playerName) throw new Error("playerName is required!");

    playerName = playerName.toLowerCase();

    const response = await fetch(`https://lichess.org/game/export/${gameId}?moves=true&pgnInJson=false&tags=false&clocks=false&evals=false&opening=false&division=false`, {
        headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch game: ${response.status}`);
    }

    const game = await response.json();

    const { white, black } = game?.players ?? {};
    const opponentOf = side => ({ name: side?.user?.name ?? "anonymous", rating: side?.rating, speed: game.speed, clock: game.clock });
    const plies = game.moves ? game.moves.split(" ").length : 0;

    if (playerName === white?.user?.name?.toLowerCase()) return { color: "w", opponent: opponentOf(black), plies };
    else if (playerName === black?.user?.name?.toLowerCase()) return { color: "b", opponent: opponentOf(white), plies };
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
let captureStreak = { w: 0, b: 0 }; // consecutive capturing moves per side
let captureRun = 0;                 // consecutive plies that were all captures
let queenTaken = null;              // { ply, white } of the last queen capture, to spot queen trades
let scrambled = false;              // time scramble already announced this game
let replayedUntil = 0;              // on connect Lichess replays recent moves; up to this ply they stay silent
let waitTimer = null;

// A move losing this much hands the watched player something big
const OPPONENT_BLUNDER = 300;
// Thinking longer than this share of the base time (at least 10 s) gets waiting music
const SLOW_SHARE = 0.15;
const SLOW_MIN = 10;
// Both clocks under this many seconds is a time scramble
const SCRAMBLE_SECONDS = 10;
let cheat = null;
let callbacks = {};

// stockfish-server interrupts the running search when a new request arrives, so evaluate one position at a time
let evalQueue = Promise.resolve();
const evaluate = fen => (evalQueue = evalQueue.catch(() => { }).then(async () => {
    const startedAt = performance.now();
    const result = await sf.evaluate(fen);
    return { ...result, startedAt, finishedAt: performance.now() };
}));

// Profiling: when the move currently being voiced arrived from Lichess (performance.now() ms)
let lastMoveReceivedAt = null;
export const moveReceivedAt = () => lastMoveReceivedAt;

let interval = null;
let polling = false;
let ws = null;

// callbacks: onMove(), onMoveInstant({ ply, san, flavor }) as soon as a move arrives, before the engine,
// onMoveDelta(delta, { before, after, thinkTime, flavor, san }) for the watched player once it's evaluated,
// onMoment(moment), onCommentary("resign"/"draw") for results,
// onGameStart(opponent), onCheatAlert(opponent, summary), onGameEnd(opponent, summary)
// moment: "game_start", "en_passant" (either side), "delivered_mate", "got_mated", "stalemated" (the watched
// player stalemated the opponent), "promotion", "knight_promotion" (either side), "check_spam" (third check
// in a row by the watched player), "opponent_blunder", "win_on_time", "you_slow", "opponent_slow",
// "time_scramble", "lost_game" (lost any way but checkmate), or a flavor
// flavor: what a move did on the board, no engine involved: "queen_trade", "lost_queen", "fork", "headshot",
// "king_capture", "bloodbath", "first_blood", "double_kill" ... "penta_kill", "opponent_double_kill".
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
        const response = await fetch(`https://lichess.org/api/users/status?ids=${encodeURIComponent(currentPlayerName)}&withGameIds=true`);
        if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
        const body = await response.json();
        const gameId = body?.[0]?.playingId ?? null;

        if (!gameId) return;

        if (gameId !== currentGameId) {
            try { ws?.close(); } catch (ignored) { }
        }

        if (!ws || ws.readyState === WebSocket.CLOSED) {
            if (gameId !== currentGameId) finishGame();
            const playerName = currentPlayerName;
            const { color, opponent, plies } = await getGameInfo(gameId, playerName);
            if (playerName !== currentPlayerName) return;
            currentGameId = gameId;
            currentPlayerColor = color;
            replayedUntil = plies;
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
        }

        if (ws?.readyState === WebSocket.OPEN) {
            ws.send("null");
        }
    } catch (error) {
        console.error("Lichess poll error:", error);
    } finally {
        polling = false;
    }
}

function finishGame() {
    if (!cheat || cheat.finished) return;
    cheat.finished = true;
    callbacks.onGameEnd?.(cheat.opponent, cheat.summary());
}

function closeGame() {
    clearTimeout(waitTimer);
    finishGame();
    currentGameId = null;
    try { ws?.close(); } catch (ignored) { }
    ws = null;
}

export function stopWatching() {
    closeGame();
    currentPlayerName = null;
}

export function getCurrentPlayerName() {
    return currentPlayerName;
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
    captureStreak = { w: 0, b: 0 };
    captureRun = 0;
    queenTaken = null;
    scrambled = false;
    clearTimeout(waitTimer);

    const sri = makeSri();
    ws = new WebSocket(`wss://socket5.lichess.org/watch/${gameId}/white/v6?sri=${sri}`, {
        headers: {
            origin: "https://lichess.org"
        }
    });

    ws.on('error', console.error);

    ws.on('message', async (data) => {
        const receivedAt = performance.now();
        try {
            await handleMessage(gameId, JSON.parse(data), receivedAt);
        } catch (error) {
            console.error("Game message error:", error);
        }
    });
}

async function handleMessage(gameId, body, receivedAt) {
    if (!body) return;

    // console.log("MESSAGE:", body);

    const messageType = body.t;
    if (messageType === "endData" || messageType === "end") {
        const { winner, status } = body.d ?? {};
        const myColor = currentPlayerColor === "w" ? "white" : "black";
        clearTimeout(waitTimer);
        if (cheat && !cheat.finished) {
            // Checkmate already had its sound on the mating move
            if (winner && winner !== myColor && status?.name !== "mate") moment("lost_game");
            else if (winner === myColor && status?.name === "outoftime") moment("win_on_time");
            else if (winner === myColor && status?.name === "resign") callbacks.onCommentary?.("resign");
            else if (!winner && ["draw", "stalemate"].includes(status?.name)) callbacks.onCommentary?.("draw");
        }
        finishGame();
        return;
    }
    if (messageType !== "move") return;

    const { fen, ply, uci, san, clock } = body.d ?? {};
    const replayed = ply <= replayedUntil;
    if (!replayed) callbacks.onMove?.();

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
    const moveFlavor =
        enPassant ? "en_passant" :
        promotion === "n" ? "knight_promotion" :
        promotion && mine ? "promotion" :
        mine && checkStreak[lastTurn] === 3 ? "check_spam" :
        flavor;
    const mate = san?.includes("#") ? (mine ? "delivered_mate" : "got_mated") : null;
    if (!replayed) {
        lastMoveReceivedAt = receivedAt;
        callbacks.onMoveInstant?.({ ply, san, flavor: mate ?? moveFlavor });
    }

    // Replayed old moves only update the board state; the newest one is still evaluated so the next move
    // has something to compare against
    if (replayed && ply < replayedUntil) return;

    // Evaluate every position: the score scores the move just played, the best move judges the next one
    const { score, bestmove, startedAt, finishedAt } = await evaluate(fullFen(fen, turn, uci));
    if (gameId !== currentGameId) return;
    console.log(`[timing] ply ${ply} ${lastTurn}: queued ${Math.round(startedAt - receivedAt)} ms, eval ${Math.round(finishedAt - startedAt)} ms, decided at +${Math.round(performance.now() - receivedAt)} ms`);

    // Mate scores are ±1e9, clamp them so a mating sequence isn't a million-centipawn swing per move
    const moverScore = clampScore(-score);
    const before = prevPosition?.ply === ply - 1 ? prevPosition : null;
    prevPosition = { ply, score, bestmove };

    // What the engine adds on top of the instant sound: stalemate (no legal moves without check), the good/bad
    // move verdict for the watched player, or the opponent hanging something. Checkmate was already called
    // from the "#" in the notation.
    const stalemate = bestmove === "(none)" && score >= 0;
    if (replayed || mate) {
        // Nothing to add: before our time, or the game is over anyway
    } else if (stalemate) {
        if (mine) moment("stalemated");
    } else if (mine && prevMyScore !== null) {
        const moveDelta = moverScore - prevMyScore;
        console.log(`Player ${lastTurn} moved, delta: ${moveDelta}, think time: ${thinkTime?.toFixed(2)}, flavor: ${moveFlavor}`);
        callbacks.onMoveDelta?.(moveDelta, { before: before ? clampScore(before.score) : null, after: moverScore, thinkTime, flavor: moveFlavor, san });
    } else if (!mine && !moveFlavor && before && clampScore(before.score) - moverScore >= OPPONENT_BLUNDER) {
        moment("opponent_blunder");
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

// What the move did on the board, most remarkable first. Updates the capture streaks, so call once per move.
function boardFlavor(prevBoard, board, uci, capture, ply, lastTurn, mine) {
    captureStreak[lastTurn] = capture ? captureStreak[lastTurn] + 1 : 0;
    captureRun = capture ? captureRun + 1 : 0;
    if (!prevBoard) return null;

    let queenFlavor = null;
    if (capture?.captured === "q") {
        const white = lastTurn !== "w"; // the captured queen's color
        queenFlavor = queenTaken?.ply === ply - 1 && queenTaken.white !== white ? "queen_trade" : !mine ? "lost_queen" : null;
        queenTaken = { ply, white };
    }

    // Once someone is on a capture streak the announcer keeps going: double, triple, quadra, penta, penta...
    const streak = captureStreak[lastTurn];
    if (mine && streak >= 2) return ["double_kill", "triple_kill", "quadra_kill", "penta_kill"][Math.min(streak, 5) - 2];
    if (queenFlavor) return queenFlavor;
    if (!mine && streak >= 2) return "opponent_double_kill";
    if (isKnightFork(board, uci)) return "fork";
    if (!capture) return null;
    if (isSnipe(uci)) return "headshot";
    if (capture.capturer === "k") return "king_capture";
    if (captureRun === 4) return "bloodbath";
    if (pieceCount(prevBoard) === 32) return "first_blood";
    return null;
}

// Waiting music when the side to move takes too long; the next move cancels it
function watchThinkTime(gameId, ply, turn, initial) {
    clearTimeout(waitTimer);
    // The clock only starts once both sides made their first move
    if (ply < 2 || !initial) return;
    const limit = Math.max(SLOW_MIN, initial * SLOW_SHARE);
    waitTimer = setTimeout(() => {
        if (gameId === currentGameId && !cheat?.finished) moment(turn === currentPlayerColor ? "you_slow" : "opponent_slow");
    }, limit * 1000);
}
