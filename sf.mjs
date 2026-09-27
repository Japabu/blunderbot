const DEPTH = parseInt(process.env.STOCKFISH_DEPTH) || 8;

// Returns { score, bestmove, depth } for the side to move in fen
async function evaluate(fen) {
    const params = new URLSearchParams();
    params.set("depth", DEPTH);
    params.set("fen", fen);
    const url = process.env.STOCKFISH_SERVER_URL + "?" + params.toString();
    // console.log("Making request:", url);
    const res = await fetch(url);
    const json = await res.json();
    // console.log("Response:", json);
    return json;
}

async function getScore(fen) {
    return (await evaluate(fen)).score;
}

export default {
    evaluate,
    getScore,
};
