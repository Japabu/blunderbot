import { classifyMove } from './move-quality.mjs';
import { clampScore } from './cheat.mjs';

// Only suspected bad moves need additional work. Reuse any existing depth-12+
// searches, including the shared tactical searches, and discard stale results.
export async function confirmBadMove({ beforeFen, afterFen, before, after, uci, thinkTime, analyze, isCurrent = () => true }) {
    const verdict = (a, b) => ({ before: clampScore(a.score), after: clampScore(-b.score), bestmove: a.bestmove,
        quality: classifyMove({ before: clampScore(a.score), after: clampScore(-b.score), bestmove: a.bestmove, uci, thinkTime }) });
    if (!verdict(before, after).quality?.slot) return { ...verdict(before, after), confirmed: false };
    if (!beforeFen || !afterFen || !isCurrent()) return null;
    const strong = async (fen, cached) => cached.depth >= 12 ? cached : analyze(fen);
    const a = await strong(beforeFen, before);
    if (!isCurrent() || a.depth < 12 || !Number.isFinite(a.score)) return null;
    const b = await strong(afterFen, after);
    if (!isCurrent() || b.depth < 12 || !Number.isFinite(b.score)) return null;
    return { ...verdict(a, b), confirmed: true };
}
