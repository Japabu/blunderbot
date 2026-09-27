import WebSocket from 'ws';

import { CheatDetector, clampScore, fetchAccount } from "./cheat.mjs";
import sf from "./sf.mjs";


async function getGameInfo(gameId, playerName) {
    if (!gameId) throw new Error("gameId is required!");
    if (!playerName) throw new Error("playerName is required!");

    playerName = playerName.toLowerCase();

    const response = await fetch(`https://lichess.org/game/export/${gameId}?moves=false&pgnInJson=false&tags=false&clocks=false&evals=false&opening=false&division=false`, {
        headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch game: ${response.status}`);
    }

    const game = await response.json();

    const { white, black } = game?.players ?? {};
    const opponentOf = side => ({ name: side?.user?.name ?? "anonymous", rating: side?.rating, speed: game.speed, clock: game.clock });

    if (playerName === white?.user?.name?.toLowerCase()) return { color: "w", opponent: opponentOf(black) };
    else if (playerName === black?.user?.name?.toLowerCase()) return { color: "b", opponent: opponentOf(white) };
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

// Piece on a square ("e4") of a FEN board, "." when empty
function squareAt(board, square) {
    const rank = board.split("/")[8 - square[1]].replace(/\d/g, n => ".".repeat(n));
    return rank[square.charCodeAt(0) - 97];
}

// Lichess only sends the board, so rebuild the rest of the FEN: castling rights are assumed while
// king and rook are still at home, and a double pawn push leaves an en passant square behind
function fullFen(board, turn, lastUci) {
    const at = square => squareAt(board, square);

    let castling = "";
    if (at("e1") === "K") castling += (at("h1") === "R" ? "K" : "") + (at("a1") === "R" ? "Q" : "");
    if (at("e8") === "k") castling += (at("h8") === "r" ? "k" : "") + (at("a8") === "r" ? "q" : "");

    let enPassant = "-";
    if (lastUci && "pP".includes(at(lastUci.slice(2, 4))) && lastUci[0] === lastUci[2] && Math.abs(lastUci[1] - lastUci[3]) === 2) {
        enPassant = lastUci[0] + (+lastUci[1] + +lastUci[3]) / 2;
    }

    return `${board} ${turn} ${castling || "-"} ${enPassant} 0 1`;
}

// A pawn landing diagonally on a square that was empty can only be an en passant capture
function isEnPassant(prevBoard, board, uci) {
    if (!prevBoard || !uci || uci[0] === uci[2]) return false;
    const dest = uci.slice(2, 4);
    return "pP".includes(squareAt(board, dest)) && squareAt(prevBoard, dest) === ".";
}


let currentPlayerName = null;
let currentGameId = null;
let currentPlayerColor = null;
let prevMyScore = null;  // watched player's score after their previous move, null until one was seen
let prevPosition = null; // { ply, score, bestmove } of the last evaluated position, side-to-move POV
let prevClocks = null;   // { white, black } seconds left after the previous move
let prevBoard = null;    // board after the previous move
let checkStreak = { w: 0, b: 0 }; // consecutive checking moves per side

// A move losing this much hands the watched player something big
const OPPONENT_BLUNDER = 300;
let cheat = null;
let callbacks = {};

// stockfish-server interrupts the running search when a new request arrives, so evaluate one position at a time
let evalQueue = Promise.resolve();
const evaluate = fen => (evalQueue = evalQueue.catch(() => { }).then(() => sf.evaluate(fen)));

let interval = null;
let polling = false;
let ws = null;

// callbacks: onMoveDelta(delta, { before, after }), onMoment(moment), onGameStart(opponent),
// onCheatAlert(opponent, summary), onGameEnd(opponent, summary)
// moment: "game_start", "en_passant" (either side), "delivered_mate", "got_mated", "stalemated" (the watched
// player stalemated the opponent), "promotion", "knight_promotion" (either side), "check_spam" (third check
// in a row by the watched player), "opponent_blunder", "win_on_time"
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
            const { color, opponent } = await getGameInfo(gameId, playerName);
            if (playerName !== currentPlayerName) return;
            currentGameId = gameId;
            currentPlayerColor = color;
            console.log("player color:", currentPlayerColor, "opponent:", opponent.name);
            if (!cheat || cheat.gameId !== gameId) {
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

    const sri = makeSri();
    ws = new WebSocket(`wss://socket5.lichess.org/watch/${gameId}/white/v6?sri=${sri}`, {
        headers: {
            origin: "https://lichess.org"
        }
    });

    ws.on('error', console.error);

    ws.on('message', async (data) => {
        try {
            await handleMessage(gameId, JSON.parse(data));
        } catch (error) {
            console.error("Game message error:", error);
        }
    });
}

async function handleMessage(gameId, body) {
    if (!body) return;

    // console.log("MESSAGE:", body);

    const messageType = body.t;
    if (messageType === "endData" || messageType === "end") {
        const { winner, status } = body.d ?? {};
        const myColor = currentPlayerColor === "w" ? "white" : "black";
        if (status?.name === "outoftime" && winner === myColor && cheat && !cheat.finished) moment("win_on_time");
        finishGame();
        return;
    }
    if (messageType !== "move") return;

    const { fen, ply, uci, san, clock } = body.d ?? {};
    if (ply === 1) moment("game_start");

    // turn = side to move now, lastTurn = side that just moved
    const turn = ply % 2 === 0 ? "w" : "b";
    const lastTurn = ply % 2 !== 0 ? "w" : "b";

    // Think time of the move just played; the clock after a move already includes the increment
    const moverClock = lastTurn === "w" ? "white" : "black";
    const increment = cheat?.opponent.clock?.increment ?? 0;
    const thinkTime = clock && prevClocks ? prevClocks[moverClock] - clock[moverClock] + increment : null;
    const clockBefore = prevClocks?.[moverClock];
    if (clock) prevClocks = clock;

    const enPassant = isEnPassant(prevBoard, fen, uci);
    prevBoard = fen;

    checkStreak[lastTurn] = san?.includes("+") ? checkStreak[lastTurn] + 1 : 0;

    // Evaluate every position: the score scores the move just played, the best move judges the next one
    const { score, bestmove } = await evaluate(fullFen(fen, turn, uci));
    if (gameId !== currentGameId) return;

    // Mate scores are ±1e9, clamp them so a mating sequence isn't a million-centipawn swing per move
    const moverScore = clampScore(-score);
    const before = prevPosition?.ply === ply - 1 ? prevPosition : null;
    prevPosition = { ply, score, bestmove };

    // No legal moves left: checkmate when the side to move is lost, otherwise stalemate
    const mine = lastTurn === currentPlayerColor;
    const gameOver = bestmove === "(none)" ? (score < 0 ? "mate" : "stalemate") : null;
    const promotion = uci?.length === 5 ? uci[4] : null;
    const special =
        gameOver === "mate" ? (mine ? "delivered_mate" : "got_mated") :
        gameOver === "stalemate" ? (mine ? "stalemated" : null) :
        enPassant ? "en_passant" :
        promotion === "n" ? "knight_promotion" :
        promotion && mine ? "promotion" :
        mine && checkStreak[lastTurn] === 3 ? "check_spam" :
        !mine && before && clampScore(before.score) - moverScore >= OPPONENT_BLUNDER ? "opponent_blunder" : null;
    if (special) moment(special);

    if (mine) {
        // Joining mid-game (or after a restart) there's nothing to compare the first move against;
        // a special moment gets its own sound instead of the delta one
        if (prevMyScore !== null && !special) {
            const moveDelta = moverScore - prevMyScore;
            console.log(`Player ${lastTurn} moved, delta: ${moveDelta}, think time: ${thinkTime?.toFixed(2)}`);
            callbacks.onMoveDelta?.(moveDelta, { before: before ? clampScore(before.score) : null, after: moverScore, thinkTime });
        }
        prevMyScore = moverScore;
    } else if (before && cheat && !cheat.finished) {
        cheat.record({ ply, uci, before: before.score, bestmove: before.bestmove, after: moverScore, thinkTime, clockBefore });
        if (cheat.shouldAlert()) callbacks.onCheatAlert?.(cheat.opponent, cheat.summary());
    }
}

function moment(name) {
    console.log("Moment:", name);
    callbacks.onMoment?.(name);
}
