import { Chess } from 'chess.js';

export const MATERIAL = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };

// Best net material gain from a legal capture and recaptures on the same square.
// Legal move generation accounts for pins, checks, king safety and promotions.
export function exchangeGain(fen, uci, budget = { nodes: 600 }) {
    const board = new Chess(fen);
    const move = board.moves({ verbose: true }).find(move => move.lan === uci);
    if (!move?.captured) return null;
    const replyGain = square => {
        if (--budget.nodes < 0) throw Error('Exchange calculation limit');
        let best = 0;
        for (const reply of board.moves({ verbose: true }).filter(move => move.to === square && move.captured)) {
            board.move(reply);
            const gain = MATERIAL[reply.captured] + (reply.promotion ? MATERIAL[reply.promotion] - 100 : 0) - replyGain(square);
            board.undo(); best = Math.max(best, gain);
        }
        return best;
    };
    board.move(move);
    return MATERIAL[move.captured] + (move.promotion ? MATERIAL[move.promotion] - 100 : 0) - replyGain(move.to);
}

export function asTurn(fen, color) {
    const fields = fen.split(' '); fields[1] = color; fields[3] = '-'; return fields.join(' ');
}
