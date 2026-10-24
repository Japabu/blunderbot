// Chess.com's published loss bands, using Lichess's public centipawn-to-win-chance
// curve. This is an approximation, not Chess.com's private rating-adjusted model.
export const winChance = cp => 1 / (1 + Math.exp(-0.00368208 * cp));
export const normalizeUci = uci => ({ e1h1: 'e1g1', e1a1: 'e1c1', e8h8: 'e8g8', e8a8: 'e8c8' }[uci] ?? uci);

export function classifyMove({ before, after, bestmove, uci, thinkTime }) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
    const loss = Math.max(0, winChance(before) - winChance(after));
    let grade = loss >= 0.20 ? 'blunder' : loss >= 0.10 ? 'mistake'
        : loss >= 0.05 ? 'inaccuracy' : loss >= 0.02 ? 'good'
        : normalizeUci(bestmove) === normalizeUci(uci) && uci ? 'best' : 'excellent';
    let slot = { best: null, excellent: null, good: null,
        inaccuracy: 'blunder_tiny', mistake: 'blunder_small', blunder: loss >= 0.45 ? 'blunder_queen' : loss >= 0.30 ? 'blunder_big' : 'blunder_medium' }[grade];
    if (grade === 'blunder' && Number.isFinite(thinkTime) && thinkTime < 1) slot = 'misinput';
    else if (loss >= 0.10 && before >= 500 && after <= 100) slot = 'threw_win';
    return { grade, loss, slot, centipawnLoss: Math.max(0, before - after) };
}
