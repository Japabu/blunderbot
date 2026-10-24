// The local website talks to this command over the existing SSH connection.
// No HTTP port, Discord token, or new credentials are exposed on the Pi.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SoundRules, EVENTS, atomicJson, soundLibrary, validateRules } from './sound-rules.mjs';
import { SettingsStore } from './settings.mjs';
import { BOT_DEFAULTS } from './sound-settings.mjs';

function read(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
export function control(request, root = '.') {
    const rules = new SoundRules(resolve(root, 'data/sound-rules.json'));
    const settings = new SettingsStore(resolve(root, 'data/settings.json'), BOT_DEFAULTS);
    const session = read(resolve(root, 'data/session.json'), {});
    const names = read(resolve(root, 'data/guilds.json'), {});
    const ids = [...new Set([...Object.keys(names), ...Object.keys(settings.guilds), ...(session.guildId ? [session.guildId] : [])])];
    const guild = request.guild ?? session.guildId ?? ids[0];
    const library = soundLibrary(root);
    const revision = () => createHash('sha256').update(JSON.stringify([settings.get(guild), rules.all(guild)])).digest('hex');
    if (request.action === 'snapshot') return { guild, guilds: ids.map(id => ({ id, name: names[id] ?? id })), settings: settings.get(guild),
        rules: rules.all(guild), events: EVENTS, library: library.map(({ path, ...clip }) => clip), revision: revision(), connected: true };
    if (request.action === 'audio') {
        const clip = library.find(clip => clip.id === request.id);
        if (!clip) throw Error('Unknown sound');
        return { audio: readFileSync(clip.path).toString('base64') };
    }
    if (!ids.includes(guild)) throw Error('Choose a known Discord server');
    if (request.action === 'save') {
        if (request.revision !== revision()) throw Error('Settings changed elsewhere. Reload before saving.');
        if (!request.settings || Object.keys(BOT_DEFAULTS).some(key => typeof request.settings[key] !== 'boolean')) throw Error('Invalid switches');
        // Validate every input before changing either file.
        validateRules(request.rules, library, true);
        rules.save(guild, request.rules, library);
        settings.update(guild, request.settings);
        return { saved: true, revision: revision() };
    }
    if (request.action === 'upload') {
        if (typeof request.audio !== 'string' || request.audio.length > 12_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(request.audio)) throw Error('Invalid audio');
        const audio = Buffer.from(request.audio, 'base64');
        if (audio.length < 100 || audio.subarray(0, 4).toString() !== 'OggS' || !audio.subarray(0, 512).includes(Buffer.from('OpusHead'))) throw Error('Expected Ogg Opus audio');
        const id = `custom/${randomUUID()}.ogg`;
        mkdirSync(resolve(root, 'data/custom'), { recursive: true });
        writeFileSync(resolve(root, 'data', id), audio);
        const name = String(request.name ?? 'Uploaded sound').slice(0, 100);
        const path = resolve(root, 'data/custom-sounds.json');
        atomicJson(path, [...read(path, []), { id, name }]);
        return { id, name, pool: 'custom' };
    }
    throw Error('Unknown action');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const input = readFileSync(0, 'utf8');
        if (input.length > 13_000_000) throw Error('Request too large');
        process.stdout.write(JSON.stringify(control(JSON.parse(input))));
    } catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1; }
}
