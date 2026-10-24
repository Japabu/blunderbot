import { Chess } from 'chess.js';
import { exchangeGain } from './tactics.mjs';

// This is a material check of the actual queen capture, not a move-quality
// verdict. Only legal recaptures on the capture square are considered, with
// exchangeGain's bounded search. Missing or inconsistent history stays quiet.
export function queenLoss({ beforeFen, afterFen, move, watchedColor, verifiedSacrificeSquare } = {}) {
    if (!beforeFen || !afterFen || !['w', 'b'].includes(watchedColor)) return null;
    const uci = typeof move === 'string' ? move : move?.from && move?.to
        ? move.from + move.to + (move.promotion ?? '') : null;
    if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
    try {
        const board = new Chess(beforeFen);
        const capture = board.moves({ verbose: true }).find(candidate => candidate.lan === uci);
        if (capture?.captured !== 'q' || capture.color === watchedColor) return null;
        const queen = board.get(capture.to);
        if (queen?.type !== 'q' || queen.color !== watchedColor) return null;
        board.move(capture);
        if (board.fen() !== new Chess(afterFen).fen()) return null;
        // The caller must only supply a verified sacrifice from the immediately
        // preceding watched move; an older sacrifice must never suppress a loss.
        if (verifiedSacrificeSquare === capture.to) return null;
        const netLoss = exchangeGain(beforeFen, uci);
        if (!Number.isFinite(netLoss) || netLoss < 100) return null;
        return { slot: 'lost_queen', square: capture.to, capturer: capture.piece, uci, netLoss };
    } catch { return null; }
}
