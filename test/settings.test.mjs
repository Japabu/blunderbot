import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../settings.mjs';
import { BOT_DEFAULTS, SOUND_DEFAULTS, soundCategory, soundEnabled } from '../sound-settings.mjs';

test('all shipped sound slots are covered and the four switches are independent', () => {
	const expected = {
		good_moves: ['good_move', 'great_move', 'fast_good_move'],
		bad_moves: ['blunder_tiny', 'blunder_small', 'blunder_medium', 'blunder_big', 'blunder_queen', 'misinput', 'threw_win'],
	};
	const slots = readdirSync(new URL('../sounds/', import.meta.url), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
	for (const slot of [...slots, 'komarov']) {
		const category = slot === 'komarov' ? 'dimitri' : Object.keys(expected).find(key => expected[key].includes(slot)) ?? 'misc';
		assert.equal(soundCategory(slot), category, slot);
		for (const toggle of Object.keys(SOUND_DEFAULTS)) {
			assert.equal(soundEnabled({ ...SOUND_DEFAULTS, [toggle]: false }, slot), toggle !== category, `${toggle}/${slot}`);
		}
	}
});

test('partial settings persist across restart and are isolated per server', () => {
	const dir = mkdtempSync(join(tmpdir(), 'blunderbot-settings-'));
	try {
		const file = join(dir, 'data/settings.json');
		const store = new SettingsStore(file, SOUND_DEFAULTS);
		assert.deepEqual(store.get('one'), SOUND_DEFAULTS);
		store.update('one', { dimitri: false, misc: false });
		store.update('one', { good_moves: false, unknown: true, bad_moves: null });
		const resumed = new SettingsStore(file, SOUND_DEFAULTS);
		assert.deepEqual(resumed.get('one'), { dimitri: false, misc: false, good_moves: false, bad_moves: true });
		assert.deepEqual(resumed.get('two'), SOUND_DEFAULTS);
		assert.equal(readFileSync(file, 'utf8').includes('unknown'), false);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed saved settings fail visibly without overwriting the file', () => {
	const dir = mkdtempSync(join(tmpdir(), 'blunderbot-settings-'));
	try {
		const file = join(dir, 'settings.json');
		writeFileSync(file, 'broken');
		assert.throws(() => new SettingsStore(file, SOUND_DEFAULTS));
		assert.equal(readFileSync(file, 'utf8'), 'broken');
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hand-and-brain is off by default and persists independently of sound preferences', () => {
	const dir = mkdtempSync(join(tmpdir(), 'blunderbot-brain-settings-'));
	try {
		const file = join(dir, 'settings.json');
		const store = new SettingsStore(file, BOT_DEFAULTS);
		assert.equal(store.get('one').hand_and_brain, false);
		assert.equal(store.get('one').ponder, true);
		store.update('one', { dimitri: false, misc: false, hand_and_brain: true, ponder: false });
		const resumed = new SettingsStore(file, BOT_DEFAULTS);
		assert.equal(resumed.get('one').hand_and_brain, true);
		assert.equal(resumed.get('one').ponder, false);
		assert.equal(resumed.get('two').ponder, true);
		assert.equal(resumed.get('two').hand_and_brain, false);
		resumed.update('one', { hand_and_brain: false });
		assert.equal(resumed.get('one').dimitri, false);
		assert.equal(resumed.get('one').misc, false);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hand-and-brain permits all bad-move effects when enabled and suppresses other categories', () => {
	const settings = { ...BOT_DEFAULTS, hand_and_brain: true };
	for (const slot of ['blunder_tiny', 'blunder_small', 'blunder_medium', 'blunder_big', 'blunder_queen', 'misinput', 'threw_win']) {
		assert.equal(soundEnabled(settings, slot), true, slot);
		assert.equal(soundEnabled({ ...settings, bad_moves: false }, slot), false, slot);
	}
	for (const slot of ['komarov', 'good_move', 'great_move', 'fast_good_move', 'double_kill', 'time_scramble', 'sus', 'game_start']) {
		assert.equal(soundEnabled(settings, slot), false, slot);
		assert.equal(soundEnabled({ ...settings, hand_and_brain: false }, slot), true, slot);
	}
});
