import { Chess } from 'chess.js';

export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const REPEAT_MS = 3000;

// Return only a piece type. The full move must never be announced to the hand.
export function pieceForBestMove(fen, bestmove) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestmove ?? '')) return null;
    try {
        const board = new Chess(fen);
        const move = board.moves({ verbose: true }).find(move =>
            move.from === bestmove.slice(0, 2) && move.to === bestmove.slice(2, 4)
            && (move.promotion ?? '') === bestmove.slice(4));
        return move ? PIECE_NAMES[move.piece] : null;
    } catch { return null; }
}

// Rebuild exact positions from the export's SAN history. Board placement alone cannot tell whether
// a king/rook moved earlier, and guessing castling rights can make the brain suggest an illegal move.
export class GamePosition {
    constructor({ moves = '', initialFen, variant = 'standard', status } = {}) {
        this.snapshots = new Map();
        this.supported = ['standard', 'fromPosition'].includes(variant?.key ?? variant);
        this.needsSync = false;
        this.valid = false;
        this.ended = status ? !['created', 'started'].includes(status) : false;
        if (!this.supported) return;
        try {
            this.board = new Chess(initialFen && initialFen !== 'startpos' ? initialFen : undefined);
            const fields = this.board.fen().split(' ');
            this.ply = (Number(fields[5]) - 1) * 2 + (fields[1] === 'b' ? 1 : 0);
            this.save();
            for (const san of moves.trim().split(/\s+/).filter(Boolean)) {
                const move = this.board.move(san);
                this.ply++;
                this.save(move);
            }
            this.valid = true;
        } catch { this.needsSync = true; }
    }

    save(move = null) {
        this.current = { fen: this.board.fen(), ply: this.ply, move };
        this.snapshots.set(this.ply, this.current);
    }

    observe({ fen, ply, san }) {
        if (!this.valid) return null;
        try {
            if (ply === this.ply + 1) {
                const move = this.board.move(san);
                this.ply = ply;
                this.save(move);
            }
            const snapshot = this.snapshots.get(ply);
            if (!snapshot || snapshot.fen.split(' ')[0] !== fen.split(' ')[0]) throw Error('Out-of-sync board');
            return snapshot;
        } catch {
            this.valid = false;
            this.needsSync = true;
            return null;
        }
    }
}

export class HandAndBrain {
    constructor({ enabled, speak }) {
        this.enabled = enabled;
        this.speak = speak;
        this.reset();
    }

    reset() {
        this.cancelRepeat();
        this.position = null;
        this.piece = null;
    }

    setPosition(position) {
        if (this.position !== position) {
            this.cancelRepeat();
            this.piece = null;
        }
        this.position = position;
    }

    analyzed(position, analysis) {
        if (!this.enabled() || !position || this.position !== position || this.piece) return;
        if (position.fen.split(' ')[1] !== position.playerColor || !Number.isFinite(analysis?.score) || !(analysis?.depth > 0)) return;
        const piece = pieceForBestMove(position.fen, analysis.bestmove);
        if (!piece) return;
        this.piece = piece;
        this.speak(piece);
        this.scheduleRepeat(position, piece);
    }

    cancelRepeat() {
        clearTimeout(this.repeatTimer);
        this.repeatTimer = null;
    }

    scheduleRepeat(position, piece) {
        this.repeatTimer = setTimeout(() => {
            this.repeatTimer = null;
            if (!this.enabled() || this.position !== position || this.piece !== piece) return;
            this.speak(piece);
            this.scheduleRepeat(position, piece);
        }, REPEAT_MS);
        this.repeatTimer.unref?.();
    }

    moved({ gameId, ply, piece } = {}) {
        this.cancelRepeat();
        if (this.enabled() && this.piece && this.position?.gameId === gameId && this.position.ply + 1 === ply
            && piece && PIECE_NAMES[piece] !== this.piece) this.speak('wrong_piece');
        this.piece = null;
    }
}
