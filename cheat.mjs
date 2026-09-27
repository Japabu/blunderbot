// Heuristic engine-assistance detector for the opponent of the watched player.
// Tracks centipawn loss and engine top-move agreement on "interesting" moves only:
// the opening and already-decided positions are skipped, since everyone plays those well.

const OPENING_PLIES = 16;      // ignore the first 8 moves of each side
const DECIDED_CP = 500;        // ignore positions that are already won/lost
const EVAL_CLAMP = 1000;       // mate scores are huge, clamp before diffing
const MIN_MOVES = 12;          // don't judge before this many counted moves

const clamp = score => Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, score));

// Lichess may encode castling as king-takes-rook (e1h1), Stockfish as e1g1
const CASTLING = { e1h1: "e1g1", e1a1: "e1c1", e8h8: "e8g8", e8a8: "e8c8" };
const normalizeUci = uci => CASTLING[uci] ?? uci;

// Rough average centipawn loss of an honest player at a given rating, as measured by a depth 8 search
// (replayed Lichess games: ~150 at 1000, ~90 at 1800, ~35 at 2500, ~25 at 3000)
export const expectedAcpl = rating => Math.max(25, 200 - 0.065 * (rating || 1500));

export class CheatDetector {
    moves = [];
    alerted = false;

    constructor(opponent) {
        this.opponent = opponent; // { name, rating, account }
    }

    // before: eval (mover's POV) of the position before the move, bestmove: engine move there,
    // after: eval (mover's POV) of the position after the move
    record({ ply, uci, before, bestmove, after }) {
        if (ply <= OPENING_PLIES) return;
        before = clamp(before);
        after = clamp(after);
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
        const expected = expectedAcpl(this.opponent.rating);
        return { n, acpl, matchRate, expected, verdict: this.#verdict(n, acpl, matchRate, expected) };
    }

    #verdict(n, acpl, matchRate, expected) {
        const account = this.opponent.account;
        if (account?.tosViolation) return "flagged";
        if (n < MIN_MOVES) return "unknown";

        // Low centipawn loss for the rating is the main signal. Engine top-move agreement is weak
        // at depth 8 (strong humans and engines both land around 40-55%), so only a very high rate counts.
        let suspicion = 0;
        if (acpl < expected * 0.3) suspicion += 2;
        if (acpl < expected * 0.2) suspicion++;
        if (matchRate >= 0.65) suspicion++;
        if (account?.fresh) suspicion++;

        if (suspicion >= 3) return "very sus";
        if (suspicion >= 2) return "sus";
        return "clean";
    }

    // True once per game, the first time the verdict turns suspicious
    shouldAlert() {
        if (this.alerted) return false;
        const { verdict } = this.summary();
        if (verdict !== "sus" && verdict !== "very sus") return false;
        this.alerted = true;
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

export function formatReport(opponent, { n, acpl, matchRate, expected, verdict }) {
    const headline = {
        "flagged": "🚨 marked by Lichess for ToS violation",
        "very sus": "🚨 VERY SUS",
        "sus": "🤨 sus",
        "clean": "✅ looks human",
        "unknown": "🤷 not enough moves to judge",
    }[verdict];

    const lines = [`**${opponent.name}** (${opponent.rating ?? "?"}): ${headline}`];
    if (n) lines.push(`ACPL ${acpl.toFixed(0)} (≈${expected.toFixed(0)} expected at this rating) · engine top move ${(matchRate * 100).toFixed(0)}% · ${n} moves counted`);
    const account = opponent.account;
    if (account?.fresh) lines.push(`fresh account: ${account.ageDays} days old, ${account.games} games`);
    return lines.join("\n");
}
