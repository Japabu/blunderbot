// Helpers for the board-only FEN Lichess sends with every move ("rnbqkbnr/pppppppp/8/...")

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const KNIGHT_JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

// Piece on a square ("e4") of a FEN board, "." when empty
export function squareAt(board, square) {
    const rank = board.split("/")[8 - square[1]].replace(/\d/g, n => ".".repeat(n));
    return rank[square.charCodeAt(0) - 97];
}

const isWhite = piece => piece !== "." && piece === piece.toUpperCase();

export const pieceCount = board => board.replace(/[\d/]/g, "").length;

// Lichess only sends the board, so rebuild the rest of the FEN: castling rights are assumed while
// king and rook are still at home, and a double pawn push leaves an en passant square behind
export function fullFen(board, turn, lastUci) {
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
export function isEnPassant(prevBoard, board, uci) {
    if (!prevBoard || !uci || uci[0] === uci[2]) return false;
    const dest = uci.slice(2, 4);
    return "pP".includes(squareAt(board, dest)) && squareAt(prevBoard, dest) === ".";
}

// What the move took and with what, as lowercase piece letters: { captured: "q", capturer: "p" }, or null
export function captureInfo(prevBoard, uci, enPassant) {
    if (!prevBoard || !uci) return null;
    const capturer = squareAt(prevBoard, uci.slice(0, 2)).toLowerCase();
    if (enPassant) return { captured: "p", capturer };
    const target = squareAt(prevBoard, uci.slice(2, 4));
    // Castling is encoded king-takes-own-rook, that's not a capture
    if (target === "." || isWhite(target) === isWhite(squareAt(prevBoard, uci.slice(0, 2)))) return null;
    return { captured: target.toLowerCase(), capturer };
}

// Taking something worth at least two pawns more than the piece that took it (the king doesn't count)
export function isUpset({ captured, capturer }) {
    return capturer !== "k" && PIECE_VALUES[captured] - PIECE_VALUES[capturer] >= 2;
}

// The knight that just moved attacks the enemy king and their queen or a rook at the same time
export function isKnightFork(board, uci) {
    const from = uci.slice(2, 4);
    const knight = squareAt(board, from);
    if (knight.toLowerCase() !== "n") return false;

    const enemy = piece => piece !== "." && isWhite(piece) !== isWhite(knight);
    const attacked = KNIGHT_JUMPS
        .map(([df, dr]) => [from.charCodeAt(0) - 97 + df, +from[1] + dr])
        .filter(([file, rank]) => file >= 0 && file < 8 && rank >= 1 && rank <= 8)
        .map(([file, rank]) => squareAt(board, String.fromCharCode(97 + file) + rank))
        .filter(enemy)
        .map(piece => piece.toLowerCase());
    return attacked.includes("k") && (attacked.includes("q") || attacked.includes("r"));
}
