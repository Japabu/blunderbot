const DEPTH = parseInt(process.env.STOCKFISH_DEPTH) || 8;
const BRAIN_DEPTH = Math.max(DEPTH, parseInt(process.env.HAND_AND_BRAIN_DEPTH) || 12);
let queue = Promise.resolve();
const enqueue = job => (queue = queue.catch(() => {}).then(job));

// Returns { score, bestmove, depth } for the side to move in fen
function evaluate(fen, { brain = false } = {}) {
    return enqueue(() => search(fen, brain));
}

async function search(fen, brain) {
    const params = new URLSearchParams();
    params.set("depth", brain ? BRAIN_DEPTH : DEPTH);
    params.set("fen", fen);
    const url = process.env.STOCKFISH_SERVER_URL + "?" + params.toString();
    // console.log("Making request:", url);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Stockfish request failed: ${res.status}`);
    const json = await res.json();
    const terminal = ['(none)', '0000'].includes(json.bestmove);
    if (!Number.isFinite(json.score) || typeof json.bestmove !== 'string'
        || !Number.isInteger(json.depth) || json.depth < 0 || (json.depth === 0 && !terminal)) throw new Error('Invalid Stockfish analysis response');
    // console.log("Response:", json);
    return json;
}

function ponderRequest(method, fen) {
    return enqueue(async () => {
        const url = process.env.STOCKFISH_SERVER_URL.replace(/\/$/, '') + '/ponder';
        const response = await fetch(url, {
            method, signal: AbortSignal.timeout(5000),
            ...(fen ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fen }) } : {}),
        });
        if (!response.ok) throw new Error(`Stockfish ponder request failed: ${response.status}`);
        return response.json();
    });
}

async function getScore(fen) {
    return (await evaluate(fen)).score;
}

export default {
    evaluate,
    getScore,
    startPonder: fen => ponderRequest('POST', fen),
    stopPonder: () => ponderRequest('DELETE'),
};
