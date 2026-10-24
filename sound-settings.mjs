export const SOUND_DEFAULTS = { dimitri: true, good_moves: true, bad_moves: true, misc: true };
export const BOT_DEFAULTS = { ...SOUND_DEFAULTS, hand_and_brain: false };

const GOOD = new Set(['good_move', 'great_move', 'fast_good_move']);
const BAD = new Set(['blunder_tiny', 'blunder_small', 'blunder_medium', 'blunder_big', 'blunder_queen', 'misinput', 'threw_win']);

export function soundCategory(slot) {
	if (slot === 'komarov') return 'dimitri';
	if (GOOD.has(slot)) return 'good_moves';
	if (BAD.has(slot)) return 'bad_moves';
	return 'misc';
}

export function soundEnabled(settings, slot, mine = true, gameOver = false) {
	const category = soundCategory(slot);
	// Confirmed results also apply when the opponent moved last or brain mode is enabled.
	const result = gameOver && ['lost_game', 'won_game'].includes(slot);
	return (mine || slot === 'komarov' || result) && settings[category]
		&& (!settings.hand_and_brain || category === 'bad_moves' || result);
}
