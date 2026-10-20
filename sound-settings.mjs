export const SOUND_DEFAULTS = { dimitri: true, good_moves: true, bad_moves: true, misc: true };

const GOOD = new Set(['good_move', 'great_move', 'fast_good_move']);
const BAD = new Set(['blunder_tiny', 'blunder_small', 'blunder_medium', 'blunder_big', 'blunder_queen', 'misinput', 'threw_win']);

export function soundCategory(slot) {
	if (slot === 'komarov') return 'dimitri';
	if (GOOD.has(slot)) return 'good_moves';
	if (BAD.has(slot)) return 'bad_moves';
	return 'misc';
}

export const soundEnabled = (settings, slot) => settings[soundCategory(slot)];
