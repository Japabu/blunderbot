async function getScore(fen) {
    const params = new URLSearchParams();
    params.set("depth", 8);
    params.set("fen", fen);
    const url = process.env.STOCKFISH_SERVER_URL + "?" + params.toString();
    // console.log("Making request:", url);
    const res = await fetch(url);
    const json = await res.json();
    // console.log("Response:", json);
    return json.score;
}

export default {
    getScore,
};