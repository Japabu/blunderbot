import { Chess } from 'chess.js';
import { asTurn, exchangeGain } from './tactics.mjs';

const PURSUERS = new Set(['p', 'n', 'b', 'r']);
const opposite = color => color === 'w' ? 'b' : 'w';
const position = fen => fen.split(' ').slice(0, 2).join(' ');

function newlyAttackedQueens(before, after, move) {
    if (!PURSUERS.has(move.piece) || move.promotion) return [];
    const fen = asTurn(after.fen(), move.color);
    return new Chess(fen).moves({ verbose: true }).filter(capture => {
        if (capture.from !== move.to || capture.captured !== 'q') return false;
        const queen = before.get(capture.to);
        if (queen?.type !== 'q' || queen.color === move.color) return false;
        // Moving along a line which already attacked this queen is not a new chase.
        if (before.attackers(capture.to, move.color).includes(move.from)) return false;
        return exchangeGain(fen, capture.lan) >= 100;
    }).map(capture => ({ color: opposite(move.color), square: capture.to }));
}

function safeRetreat(after, color, square) {
    const fen = asTurn(after.fen(), opposite(color));
    return !new Chess(fen).moves({ verbose: true }).some(capture =>
        capture.to === square && capture.captured === 'q' && exchangeGain(fen, capture.lan) >= 100);
}

// A chase needs two consecutive attack/escape pairs against the same queen.
// Each subsequent consecutive safe escape may react too; there is no cooldown.
export class QueenChase {
    constructor() { this.reset(); }

    reset() {
        this.chase = null;
        this.lastPly = null;
        this.lastAfter = null;
    }

    observe({ beforeFen, afterFen, move, ply } = {}) {
        try {
            if (!Number.isSafeInteger(ply) || ply < 1 || !move?.from || !move?.to) throw Error('Incomplete move');
            const before = new Chess(beforeFen), after = new Chess(afterFen);
            const played = before.moves({ verbose: true }).find(candidate =>
                candidate.from === move.from && candidate.to === move.to && candidate.promotion === move.promotion);
            if (!played || (move.color && move.color !== played.color) || (move.piece && move.piece !== played.piece)) throw Error('Invalid move');
            const replay = new Chess(beforeFen);
            replay.move(played);
            if (position(replay.fen()) !== position(after.fen())) throw Error('Position mismatch');

            if (this.lastPly !== null && (ply !== this.lastPly + 1 || position(beforeFen) !== this.lastAfter)) this.chase = null;
            this.lastPly = ply;
            this.lastAfter = position(after.fen());

            const tracked = this.chase;
            if (tracked) {
                const queen = before.get(tracked.square);
                if (queen?.type !== 'q' || queen.color !== tracked.color) this.chase = null;
            }
            // Promotions create new piece identities; do not carry a chase across them.
            if (played.promotion) { this.chase = null; return false; }

            if (this.chase?.phase === 'attacked') {
                const chase = this.chase;
                if (played.color === chase.color && played.piece === 'q' && played.from === chase.square
                    && !played.captured && safeRetreat(after, chase.color, played.to)) {
                    this.chase = { ...chase, square: played.to, escapes: chase.escapes + 1, phase: 'escaped' };
                    return this.chase.escapes >= 2;
                }
                this.chase = null;
            }

            const attacks = newlyAttackedQueens(before, after, played);
            // An ambiguous multi-queen position must not join different queens' escapes.
            if (attacks.length !== 1) { this.chase = null; return false; }
            const target = attacks[0];
            const continuing = this.chase?.phase === 'escaped' && this.chase.color === target.color
                && this.chase.square === target.square && played.color !== target.color;
            this.chase = { ...target, escapes: continuing ? this.chase.escapes : 0, phase: 'attacked' };
            return false;
        } catch {
            this.reset();
            return false;
        }
    }
}
