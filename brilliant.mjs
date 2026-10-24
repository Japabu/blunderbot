import { Chess } from 'chess.js';
import { MATERIAL, asTurn, exchangeGain } from './tactics.mjs';
import { winChance, normalizeUci } from './move-quality.mjs';

// A candidate must offer a non-pawn piece at a real net material cost, rather
// than exchanging equal pieces or merely collecting a more valuable target.
export function sacrificeCandidates(beforeFen, afterFen, uci) {
    try {
        const before = new Chess(beforeFen), after = new Chess(afterFen);
        const played = before.moves({ verbose: true }).find(move => move.lan === uci);
        if (!played || played.promotion) return [];
        const capturedValue = MATERIAL[played.captured] ?? 0;
        const captures = after.moves({ verbose: true }).filter(move => ['n', 'b', 'r', 'q'].includes(move.captured));
        const offers = [];
        for (const capture of captures) {
            const gain = exchangeGain(afterFen, capture.lan);
            if (gain - capturedValue < 100) continue;
            if (capture.to !== played.to) {
                const old = new Chess(asTurn(beforeFen, after.turn()));
                const wasHanging = old.moves({ verbose: true }).filter(move => move.to === capture.to && move.captured)
                    .some(move => exchangeGain(old.fen(), move.lan) >= gain);
                if (wasHanging) continue;
            }
            offers.push({ uci: capture.lan, square: capture.to, investment: gain - capturedValue });
        }
        // Validate every profitable acceptance of the main offered piece. Very
        // complex positions fail closed rather than starting unbounded searches.
        offers.sort((a, b) => b.investment - a.investment);
        const selected = offers.filter(offer => offer.square === offers[0]?.square);
        return selected.length <= 3 ? selected : [];
    } catch { return []; }
}

export async function verifyBrilliant({ beforeFen, afterFen, uci, analyze, isCurrent = () => true }) {
    uci = normalizeUci(uci);
    const offers = sacrificeCandidates(beforeFen, afterFen, uci);
    if (!offers.length || !isCurrent()) return null;
    const before = await analyze(beforeFen, { multipv: 2 });
    if (!isCurrent() || before.depth < 12 || !Number.isFinite(before.score) || before.variations?.length !== 2) return null;
    const lines = before.variations;
    if (lines.some(line => line.depth !== before.depth || !Number.isFinite(line.score) || !line.moves?.length)) return null;
    if (!lines.some(line => line.moves[0] === uci)) return null;
    const alternative = lines.find(line => line.moves[0] !== uci);
    if (!alternative || alternative.score >= 300) return null; // Already easily winning without the sacrifice.
    const after = await analyze(afterFen);
    if (!isCurrent() || after.depth < 12 || !Number.isFinite(after.score)) return null;
    const score = -after.score;
    if (score < -50 || winChance(before.score) - winChance(score) > 0.02) return null;
    for (const offer of offers) {
        if (!isCurrent()) return null;
        const board = new Chess(afterFen); board.move(offer.uci);
        const accepted = await analyze(board.fen());
        if (!isCurrent() || accepted.depth < 12 || !Number.isFinite(accepted.score) || accepted.score < -50
            || winChance(before.score) - winChance(accepted.score) > 0.02) return null;
    }
    return { grade: 'brilliant', slot: 'brilliant_move', sacrifice: offers[0].square, depth: Math.min(before.depth, after.depth) };
}

export async function verifyGreat({ beforeFen, afterFen, uci, previousMove, baseline, analyze, isCurrent = () => true }) {
    uci = normalizeUci(uci);
    // Taking back the piece just captured is an ordinary response even when it
    // is the only non-losing move. Genuine sacrifices still use Brilliant.
    if (previousMove?.captured) {
        const move = new Chess(beforeFen).moves({ verbose: true }).find(move => move.lan === uci);
        if (move?.captured && move.to === previousMove.to && !move.promotion) return null;
    }
    const qualifies = result => {
        const [best, second] = result?.variations ?? [];
        return best?.moves?.[0] === uci && second?.moves?.[0] !== uci && Number.isFinite(best?.score)
            && Number.isFinite(second?.score) && best.depth === result.depth && second.depth === result.depth
            && winChance(best.score) - winChance(second.score) >= 0.10;
    };
    if (!isCurrent() || !qualifies(baseline)) return null;
    const before = await analyze(beforeFen, { multipv: 2 });
    if (!isCurrent() || before.depth < 12 || !qualifies(before)) return null;
    const after = await analyze(afterFen);
    if (!isCurrent() || after.depth < 12 || !Number.isFinite(after.score) || -after.score < -50
        || winChance(before.score) - winChance(-after.score) > 0.02) return null;
    return { grade: 'great', slot: 'great_move', depth: Math.min(before.depth, after.depth) };
}
