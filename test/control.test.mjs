import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { control } from '../control-cli.mjs';
import { SoundRules } from '../sound-rules.mjs';
import { SettingsStore } from '../settings.mjs';
import { BOT_DEFAULTS } from '../sound-settings.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'blunderbot-control-test-'));
    mkdirSync(join(root, 'sounds/attack_up'), { recursive: true });
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'sounds/attack_up/reload.ogg'), 'test clip');
    writeFileSync(join(root, 'data/guilds.json'), JSON.stringify({ '123': 'D MEME', '456': 'Other' }));
    writeFileSync(join(root, 'data/session.json'), JSON.stringify({ guildId: '123' }));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}
test('live settings and pools survive restart, remain per-server, and reject stale saves', t => {
    const root = fixture(t);
    const settings = new SettingsStore(join(root, 'data/settings.json'), BOT_DEFAULTS);
    const rules = new SoundRules(join(root, 'data/sound-rules.json'));
    const snapshot = control({ action: 'snapshot' }, root);
    assert.equal(snapshot.guild, '123');
    assert.equal(snapshot.guilds[0].name, 'D MEME');
    assert.equal(rules.get('123', 'attack_up').side, 'both');
    snapshot.rules.attack_up.side = 'opponent';
    snapshot.rules.attack_up.clips = ['attack_up/reload.ogg'];
    snapshot.settings.dimitri = false;
    snapshot.timing.blitz = 4;
    const saved = control({ ...snapshot, action: 'save' }, root);
    assert.equal(settings.get('123').dimitri, false, 'a running store sees external edits');
    assert.equal(control({ action: 'snapshot' }, root).timing.blitz, 4);
    assert.equal(control({ action: 'snapshot', guild: '456' }, root).timing.blitz, 5);
    assert.equal(rules.get('123', 'attack_up').side, 'opponent');
    assert.equal(control({ action: 'snapshot', guild: '456' }, root).settings.dimitri, true);
    assert.notEqual(saved.revision, snapshot.revision);
    assert.throws(() => control({ ...snapshot, action: 'save' }, root), /changed elsewhere/);
    assert.deepEqual(control({ action: 'snapshot' }, root).rules.attack_up.clips, ['attack_up/reload.ogg']);
});
test('saving active rules preserves retired custom pools and validates timing before writing', t => {
    const root = fixture(t), snapshot = control({ action: 'snapshot' }, root);
    snapshot.archivedRules = { excellent_move: { enabled: true, side: 'you', clips: ['attack_up/reload.ogg'] } };
    control({ ...snapshot, action: 'save' }, root);
    const next = control({ action: 'snapshot' }, root);
    assert.deepEqual(next.archivedRules.excellent_move.clips, ['attack_up/reload.ogg']);
    next.timing.blitz = 0;
    next.settings.misc = false;
    assert.throws(() => control({ ...next, action: 'save' }, root), /Waiting times/);
    assert.equal(control({ action: 'snapshot' }, root).settings.misc, true);
});
test('invalid pools cannot write settings or escape the sound library', t => {
    const root = fixture(t), snapshot = control({ action: 'snapshot' }, root);
    snapshot.rules.attack_up.clips = ['../../.env'];
    snapshot.settings.dimitri = false;
    assert.throws(() => control({ ...snapshot, action: 'save' }, root), /Unknown sound/);
    assert.equal(control({ action: 'snapshot' }, root).settings.dimitri, true);
    assert.throws(() => control({ action: 'audio', id: '../../.env' }, root), /Unknown sound/);
    snapshot.rules.attack_up.clips = [];
    snapshot.rules.great_move.side = 'both';
    assert.throws(() => control({ ...snapshot, action: 'save' }, root), /your moves only/);
});
test('uploaded Opus sounds persist and can be assigned and previewed without changing defaults', t => {
    const root = fixture(t);
    const bytes = readFileSync(new URL('../sounds/discovery/xqc_fossil.ogg', import.meta.url));
    const clip = control({ action: 'upload', guild: '123', name: 'Test sound', audio: bytes.toString('base64') }, root);
    assert.match(clip.id, /^custom\/[a-f0-9-]+\.ogg$/);
    const snapshot = control({ action: 'snapshot' }, root);
    assert.equal(snapshot.library.some(item => item.id === clip.id), true);
    assert.equal(snapshot.rules.discovery.clips, null);
    snapshot.rules.discovery.clips = [clip.id];
    control({ ...snapshot, action: 'save' }, root);
    assert.equal(control({ action: 'audio', id: clip.id }, root).audio, bytes.toString('base64'));
    assert.throws(() => control({ action: 'upload', guild: '123', audio: Buffer.from('not an audio file').toString('base64') }, root), /Opus/);
});
