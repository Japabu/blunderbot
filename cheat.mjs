// Heuristic engine-assistance detector for the opponent of the watched player.
// Tracks centipawn loss, engine top-move agreement and think times on "interesting" moves only:
// the opening and already-decided positions are skipped, since everyone plays those well.
// Thresholds come from replaying Lichess games of normal players and of accounts Lichess marked
// for ToS violations: they flag ~5% of human games and catch 4 of 5 marked engine accounts.

const OPENING_PLIES = 16;      // ignore the first 8 moves of each side
const DECIDED_CP = 500;        // ignore positions that are already won/lost
const EVAL_CLAMP = 1000;       // mate scores are huge, clamp before diffing
const MIN_MOVES = 12;          // don't judge before this many counted moves
const MIN_TIMED_MOVES = 10;    // don't judge move-time consistency before this many think times
const SCRAMBLE = 0.15;         // below this share of the starting clock everyone just moves fast

export const clampScore = score => Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, score));

// Lichess may encode castling as king-takes-rook (e1h1), Stockfish as e1g1
const CASTLING = { e1h1: "e1g1", e1a1: "e1c1", e8h8: "e8g8", e8a8: "e8c8" };
const normalizeUci = uci => CASTLING[uci] ?? uci;

// Faster games mean more mistakes at the same rating (measured: bullet ~15% more ACPL than blitz,
// rapid and classical ~20% less); ultra bullet and correspondence are extrapolated
const SPEED_FACTOR = { ultraBullet: 1.3, bullet: 1.15, blitz: 1, rapid: 0.8, classical: 0.8, correspondence: 0.7 };

// Rough average centipawn loss of an honest player at a given rating and speed, as measured by a
// depth 8 search (blitz: ~150 at 1000, ~90 at 1800, ~35 at 2500, ~25 at 3000)
export const expectedAcpl = (rating, speed) => Math.max(25, 200 - 0.065 * (rating || 1500)) * (SPEED_FACTOR[speed] ?? 1);

const LEVELS = ["clean", "sus", "very sus"];

export class CheatDetector {
    moves = [];
    thinkTimes = [];
    alertedLevel = 0;

    constructor(opponent) {
        this.opponent = opponent; // { name, rating, speed, clock: { initial, increment }, account }
    }

    // before: eval (mover's POV) of the position before the move, bestmove: engine move there,
    // after: eval (mover's POV) of the position after the move,
    // thinkTime/clockBefore: seconds spent on the move and left before it, when known
    record({ ply, uci, before, bestmove, after, thinkTime, clockBefore }) {
        if (ply <= OPENING_PLIES) return;

        const initial = this.opponent.clock?.initial;
        if (thinkTime >= 0 && initial && clockBefore > initial * SCRAMBLE) this.thinkTimes.push(thinkTime);

        before = clampScore(before);
        after = clampScore(after);
        if (Math.abs(before) > DECIDED_CP) return;

        this.moves.push({
            loss: Math.max(0, before - after),
            match: normalizeUci(uci) === normalizeUci(bestmove),
        });
    }

    summary() {
        const n = this.moves.length;
        const acpl = n ? this.moves.reduce((sum, m) => sum + m.loss, 0) / n : null;
        const matchRate = n ? this.moves.filter(m => m.match).length / n : null;
        const expected = expectedAcpl(this.opponent.rating, this.opponent.speed);
        const timeCv = this.#timeCv();
        return { n, acpl, matchRate, expected, timeCv, verdict: this.#verdict(n, acpl, matchRate, expected, timeCv) };
    }

    // Coefficient of variation of think times: humans premove and recapture instantly but sink time
    // into critical positions (CV ~0.7-1.3), someone copying engine moves takes a similar time for every move
    #timeCv() {
        const times = this.thinkTimes;
        if (times.length < MIN_TIMED_MOVES) return null;
        const mean = times.reduce((a, b) => a + b, 0) / times.length;
        if (!mean) return null;
        return Math.sqrt(times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / times.length) / mean;
    }

    #verdict(n, acpl, matchRate, expected, timeCv) {
        const account = this.opponent.account;
        if (account?.tosViolation) return "flagged";
        if (n < MIN_MOVES) return "unknown";

        // Low centipawn loss for the rating and time control is the main signal. Engine top-move agreement
        // is weak at depth 8 (humans and engines both land around 40-55%), so only a high rate counts.
        // In bullet everyone moves at a steady pace, so move-time consistency only counts in slower games.
        let suspicion = 0;
        if (acpl < expected * 0.45) suspicion++;
        if (acpl < expected * 0.3) suspicion++;
        if (acpl < expected * 0.2) suspicion++;
        if (matchRate >= 0.6) suspicion++;
        if (timeCv !== null && timeCv < 0.6 && !/bullet/i.test(this.opponent.speed ?? "")) suspicion++;
        if (account?.fresh) suspicion++;

        return LEVELS[Math.min(suspicion, 3) - 1] ?? "clean";
    }

    // True when the verdict gets worse: once on turning sus, again on turning very sus
    shouldAlert() {
        const level = LEVELS.indexOf(this.summary().verdict);
        if (level <= this.alertedLevel) return false;
        this.alertedLevel = level;
        return true;
    }
}

// Public account signals: Lichess' own cheat flag and throwaway-account markers
export async function fetchAccount(name) {
    try {
        const res = await fetch(`https://lichess.org/api/user/${encodeURIComponent(name)}`);
        if (!res.ok) return null;
        const user = await res.json();
        const ageDays = (Date.now() - user.createdAt) / 86_400_000;
        return {
            tosViolation: !!user.tosViolation,
            ageDays: Math.floor(ageDays),
            games: user.count?.all ?? 0,
            fresh: ageDays < 30 || (user.count?.all ?? 0) < 50,
        };
    } catch (error) {
        console.error("Lichess user fetch error:", error);
        return null;
    }
}

export function formatReport(opponent, { n, acpl, matchRate, expected, timeCv, verdict }) {
    const headline = {
        "flagged": "marked by Lichess for ToS violation",
        "very sus": "VERY SUS",
        "sus": "sus",
        "clean": "looks human",
        "unknown": "not enough moves to judge",
    }[verdict];

    const parts = [`${opponent.name} (${opponent.rating ?? "?"} ${opponent.speed ?? ""}): ${headline}`];
    if (n) parts.push(`ACPL ${acpl.toFixed(0)} (~${expected.toFixed(0)} expected)`, `engine top move ${(matchRate * 100).toFixed(0)}%`, `${n} moves counted`);
    if (timeCv !== null && timeCv !== undefined) parts.push(`think-time CV ${timeCv.toFixed(2)}`);
    const account = opponent.account;
    if (account?.fresh) parts.push(`fresh account: ${account.ageDays} days old, ${account.games} games`);
    return parts.join(" | ");
}
