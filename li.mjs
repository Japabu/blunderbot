import WebSocket from 'ws';

import { CheatDetector, fetchAccount } from "./cheat.mjs";
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
    const opponentOf = side => ({ name: side?.user?.name ?? "anonymous", rating: side?.rating });

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


let currentPlayerName = null;
let currentGameId = null;
let currentPlayerColor = null;
let prevMyScore = 0;
let prevPosition = null; // { ply, score, bestmove } of the last evaluated position, side-to-move POV
let cheat = null;
let callbacks = {};

// stockfish-server interrupts the running search when a new request arrives, so evaluate one position at a time
let evalQueue = Promise.resolve();
const evaluate = fen => (evalQueue = evalQueue.catch(() => { }).then(() => sf.evaluate(fen)));

let interval = null;
let ws = null;

// callbacks: onMoveDelta(delta), onGameStart(opponent), onCheatAlert(opponent, summary), onGameEnd(opponent, summary)
export async function watchPlayer(playerName, newCallbacks) {
    callbacks = newCallbacks;
    if (currentPlayerName === playerName) return;

    console.log("watching player: " + playerName);
    currentPlayerName = playerName;

    if (!interval) {
        interval = setInterval(async () => {
            if (!currentPlayerName) return;

            const response = await fetch(`https://lichess.org/api/users/status?ids=${currentPlayerName}&withGameIds=true`);
            const body = await response.json();
            const gameId = body?.[0]?.playingId ?? null;

            if (!gameId) return;

            if (gameId !== currentGameId) {
                try { ws?.close(); } catch (ignored) { }
            }

            if (!ws || ws.readyState === WebSocket.CLOSED) {
                if (gameId !== currentGameId) finishGame();
                currentGameId = gameId;
                const { color, opponent } = await getGameInfo(gameId, currentPlayerName);
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
        }, 3000);
    }
}

function finishGame() {
    if (!cheat || cheat.finished) return;
    cheat.finished = true;
    callbacks.onGameEnd?.(cheat.opponent, cheat.summary());
}

export function stopWatching() {
    finishGame();
    currentPlayerName = null;
    try { ws?.close(); } catch (ignored) { }
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

    prevMyScore = 0;
    prevPosition = null;

    const sri = makeSri();
    ws = new WebSocket(`wss://socket5.lichess.org/watch/${gameId}/white/v6?sri=${sri}`, {
        headers: {
            origin: "https://lichess.org"
        }
    });

    ws.on('error', console.error);

    ws.on('message', async (data) => {
        const body = JSON.parse(data);
        if (!body) return;

        // console.log("MESSAGE:", body);

        const messageType = body.t;
        if (messageType === "endData" || messageType === "end") {
            finishGame();
            return;
        }
        if (messageType !== "move") return;

        const { fen, ply, uci } = body.d ?? {};

        // turn = side to move now, lastTurn = side that just moved
        const turn = ply % 2 === 0 ? "w" : "b";
        const lastTurn = ply % 2 !== 0 ? "w" : "b";

        // Evaluate every position: the score scores the move just played, the best move judges the next one
        const { score, bestmove } = await evaluate(fen + " " + turn);
        if (gameId !== currentGameId) return;

        const moverScore = -score;
        const before = prevPosition;
        prevPosition = { ply, score, bestmove };

        if (lastTurn === currentPlayerColor) {
            const moveDelta = moverScore - prevMyScore;
            prevMyScore = moverScore;
            console.log(`Player ${lastTurn} moved, delta: ${moveDelta}`);
            callbacks.onMoveDelta?.(moveDelta);
        } else if (before?.ply === ply - 1 && cheat && !cheat.finished) {
            cheat.record({ ply, uci, before: before.score, bestmove: before.bestmove, after: moverScore });
            if (cheat.shouldAlert()) callbacks.onCheatAlert?.(cheat.opponent, cheat.summary());
        }
    });
}
