import WebSocket from 'ws';
import ndjsonStream from 'can-ndjson-stream';

import sf from "./sf.mjs";


async function fetchFirstLineAndDisconnect(url) {
    const response = await fetch(url);
    const exampleStream = ndjsonStream(response.body);
    const reader = exampleStream.getReader();
    const result = await reader.read();

    if (result.done) {
        throw new Error("First line could not be read as stream is already done!");
    }

    return result.value;
};

async function getPlayerColor(gameId, playerName) {
    if (!gameId) throw new Error("gameId is required!");
    if (!playerName) throw new Error("playerName is required!");

    playerName = playerName.toLowerCase();

    const response = await fetchFirstLineAndDisconnect("https://lichess.org/api/stream/game/" + gameId);

    const whitePlayerName = response?.players?.white?.user?.name?.toLowerCase();
    const blackPlayerName = response?.players?.black?.user?.name?.toLowerCase();

    if (playerName === whitePlayerName) return "w";
    else if (playerName === blackPlayerName) return "b";
    else throw new Error('Player not found', response);
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
let prevWhiteScore = 0;
let prevBlackScore = 0;

let interval = null;
let ws = null;

export async function watchPlayerBlunders(playerName, moveDeltaCallback) {
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
                currentGameId = gameId;
                currentPlayerColor = await getPlayerColor(gameId, playerName);
                console.log("player color:", currentPlayerColor);
                connectToGame(gameId, moveDeltaCallback);
            }

            if (ws?.readyState === WebSocket.OPEN) {
                ws.send("null");
            }
        }, 3000);
    }
}

export function stopWatching() {
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

function connectToGame(gameId, moveDeltaCallback) {
    console.log("connecting to game: " + gameId);

    prevWhiteScore = 0;
    prevBlackScore = 0;

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
        if (messageType !== "move") return;

        let fen = body.d?.fen;

        const ply = body.d?.ply;

        // turn = opponent
        // lastTurn = me
        const turn = ply % 2 === 0 ? "w" : "b";
        const lastTurn = ply % 2 !== 0 ? "w" : "b";

        if (lastTurn !== currentPlayerColor) return;

        // Score the last move by calculating the score for the next best move for the opponent
        fen += " " + turn;

        const newScore = -(await sf.getScore(fen));
        let oldScore;
        if (lastTurn === "w") {
            oldScore = prevWhiteScore;
            prevWhiteScore = newScore;
        } else {
            oldScore = prevBlackScore;
            prevBlackScore = newScore;
        }

        const moveDelta = newScore - oldScore;
        console.log(`Player ${lastTurn} moved, delta: ${moveDelta}`);
        moveDeltaCallback(moveDelta);
    });
}
