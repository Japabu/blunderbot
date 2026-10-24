import { defaultRule, eventFor } from './sound-rules.mjs';

export const SOUND_DEFAULTS = { dimitri: true, good_moves: true, bad_moves: true, misc: true };
export const BOT_DEFAULTS = { ...SOUND_DEFAULTS, hand_and_brain: false };

const GOOD = new Set(['good_move', 'great_move', 'excellent_move', 'brilliant_move']);
const BAD = new Set(['blunder_tiny', 'blunder_small', 'blunder_medium', 'blunder_big', 'blunder_queen', 'misinput', 'threw_win']);

export function soundCategory(slot) {
	if (slot === 'komarov') return 'dimitri';
	if (GOOD.has(slot)) return 'good_moves';
	if (BAD.has(slot)) return 'bad_moves';
	return 'misc';
}

export function soundEnabled(settings, slot, mine = true, gameOver = false, override) {
	const category = soundCategory(slot);
	const event = eventFor(slot);
	const rule = override ?? defaultRule(slot);
	const result = gameOver && ['lost_game', 'won_game', 'lost_on_time'].includes(slot);
	const sideAllowed = slot === 'komarov' || event?.group === 'game' || result
		|| (rule.side === 'both' || (mine ? rule.side === 'you' : rule.side === 'opponent'));
    return rule.enabled && sideAllowed && (mine || !['good_moves', 'bad_moves'].includes(category)) && settings[category]
		&& (!settings.hand_and_brain || category === 'bad_moves' || result);
}
