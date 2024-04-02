import WebSocket from 'ws';
import sf from "./sf.mjs";

const BLUNDER_DELTA = -150;

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
let prevWhiteScore = 0;
let prevBlackScore = 0;

let interval = null;
let ws = null;

export async function watchPlayerBlunders(playerName, blunderCallback) {
    if (currentPlayerName === playerName) return;

    console.log("watching player: " + playerName);
    currentPlayerName = playerName;

    if (!interval) {
        interval = setInterval(async () => {
            if (!currentPlayerName) return;

            const response = await fetch(`https://lichess.org/api/users/status?ids=${currentPlayerName}&withGameIds=true`);
            const body = await response.json();
            const gameId = body?.[0]?.playingId ?? null;

            if (gameId !== currentGameId) {
                try { ws?.close(); } catch (ignored) { }
            }

            if (!ws || ws.readyState === WebSocket.CLOSED) {
                currentGameId = gameId;
                if (gameId) connectToGame(gameId, blunderCallback);
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

function connectToGame(gameId, blunderCallback) {
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

        const messageType = body.t;
        if (messageType !== "move") return;
        // console.log("message: %s", data);

        let fen = body.d?.fen;

        const ply = body.d?.ply;
        const turn = ply % 2 === 0 ? "w" : "b";
        const lastTurn = ply % 2 !== 0 ? "w" : "b";

        // Score the last move by calculating the score for the next best move for the opponent
        // turn = opponent
        // lastTurn = me
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

        if (moveDelta <= BLUNDER_DELTA) {
            blunderCallback();
        }
    });
}
