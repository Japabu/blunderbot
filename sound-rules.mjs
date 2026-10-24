import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const event = (id, name, group, description, pool = id, extra = {}) => ({ id, name, group, description, pool, ...extra });
export const EVENTS = [
    event('brilliant_move', 'Brilliant move', 'quality', 'A sound piece or exchange sacrifice, verified at depth 12+ against alternatives and accepting the sacrifice.', 'great_move'),
    event('great_move', 'Great move', 'quality', 'You found the only good option: depth-12+ analysis confirms alternatives lose at least 10 percentage points. Normal moves stay quiet.'),
    event('blunder_tiny', 'Inaccuracy', 'quality', 'Between 5 and 10 percentage points lost.'),
    event('blunder_small', 'Mistake', 'quality', 'Between 10 and 20 percentage points lost.'),
    event('blunder_medium', 'Blunder', 'quality', 'Between 20 and 30 percentage points lost.'),
    event('blunder_big', 'Big blunder', 'quality', 'Between 30 and 45 percentage points lost.'),
    event('blunder_queen', 'Huge blunder', 'quality', 'At least 45 percentage points lost; not necessarily a queen.'),
    event('misinput', 'Instant blunder', 'quality', 'A blunder played in less than one second.'),
    event('threw_win', 'Thrown win', 'quality', 'From +5 or better to +1 or worse, losing at least 10 percentage points.'),
    event('attack_up', 'Attack a higher piece', 'special', 'Every new legal threat by the moved piece against a higher piece. Pawn chases and queen harassment can trigger every move. Existing attacks and king attacks stay quiet.'),
    event('discovery', 'Discovered tactic', 'special', 'An uncovered check or a material-winning threat after recaptures. Ordinary trades and pawn-only threats stay quiet.'),
    event('castle', 'Castling', 'special', 'Kingside or queenside castling.', null, { enabled: false }),
    event('capture', 'Any capture', 'special', 'An ordinary capture without a more specific event.', null, { enabled: false }),
    event('en_passant', 'En passant', 'special', 'An en passant capture.'),
    event('promotion', 'Promotion', 'special', 'Promoting a pawn to a queen, rook or bishop.'),
    event('knight_promotion', 'Knight promotion', 'special', 'Underpromoting to a knight.'),
    event('check_spam', 'Three checks in a row', 'special', 'Optional joke for three successive checks; off by default because checks can be routine.', 'check_spam', { enabled: false }),
    event('fork', 'Knight fork', 'special', 'A knight attacks the king and a queen or rook.'),
    event('king_capture', 'King captures', 'special', 'Optional joke for king captures; off by default because normal endgame captures are routine.', 'king_capture', { enabled: false }),
    event('lost_queen', 'Your queen is captured', 'special', 'The opponent captures your queen.'),
    event('queen_trade', 'Queen exchange', 'special', 'Optional reaction to a queen exchange; off by default because a normal trade is not a tactic.', 'queen_trade', { enabled: false }),
    event('game_start', 'Game starts', 'game', 'A new game is found before the second move.'),
    event('won_game', 'You win', 'game', 'A confirmed win, including mate, resignation, timeout or abandonment.'),
    event('lost_game', 'You lose', 'game', 'A confirmed loss, including mate, resignation, timeout or abandonment.'),
    event('stalemated', 'You give stalemate', 'game', 'Your move leaves the opponent with no legal move and no check.'),
    event('you_slow', 'You take too long', 'game', 'One waiting sound per turn, after the delay below. Stops when you move.'),
    event('opponent_slow', 'Opponent takes too long', 'game', 'One waiting sound per turn, after the same delay. Stops when they move.'),
    event('time_scramble', 'Time scramble', 'game', 'Optional music when both clocks are below ten seconds; off by default to keep clock pressure quiet.', 'time_scramble', { enabled: false }),
    event('sus', 'Lichess account flag', 'game', 'The opponent has a Lichess terms-of-service flag at game start.'),
];
export const EVENT_IDS = new Set(EVENTS.map(event => event.id));
export const eventFor = id => EVENTS.find(event => event.id === id);
export function defaultRule(id) {
    const event = eventFor(id);
    return { enabled: event?.enabled ?? true, side: event?.group === 'quality' ? 'you' : 'both', clips: null };
}

function readJson(path, fallback) {
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function atomicJson(path, value) {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2));
    renameSync(temp, path);
}
export function soundLibrary(root = '.') {
    const clips = [];
    for (const dir of readdirSync(join(root, 'sounds'), { withFileTypes: true })) {
        if (!dir.isDirectory() || dir.name === 'fast_good_move') continue;
        for (const file of readdirSync(join(root, 'sounds', dir.name)).filter(file => file.endsWith('.ogg'))) {
            clips.push({ id: `${dir.name}/${file}`, name: file.replace(/\.ogg$/, '').replaceAll('_', ' '), pool: dir.name,
                path: join(root, 'sounds', dir.name, file) });
        }
    }
    for (const clip of readJson(join(root, 'data/custom-sounds.json'), [])) {
        if (/^custom\/[a-f0-9-]+\.ogg$/.test(clip.id)) clips.push({ ...clip, pool: 'custom', path: join(root, 'data', clip.id) });
    }
    return clips;
}
export function validateRules(rules, library, complete = false) {
    const ids = new Set(library.map(clip => clip.id));
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)
        || (complete && Object.keys(rules).length !== EVENTS.length)) throw Error('Invalid or incomplete rules');
    const clean = {};
    for (const [id, rule] of Object.entries(rules)) {
        if (!EVENT_IDS.has(id) || !rule || typeof rule.enabled !== 'boolean' || !['you', 'opponent', 'both'].includes(rule.side)) throw Error('Invalid event rule');
        if (eventFor(id).group === 'quality' && rule.side !== 'you') throw Error('Move quality is for your moves only');
        if (rule.clips !== null && (!Array.isArray(rule.clips) || rule.clips.length > 50 || rule.clips.some(id => !ids.has(id)))) throw Error('Unknown sound in pool');
        clean[id] = { enabled: rule.enabled, side: rule.side, clips: rule.clips === null ? null : [...new Set(rule.clips)] };
    }
    return clean;
}
export class SoundRules {
    constructor(path = './data/sound-rules.json') { this.path = path; this.stamp = null; this.guilds = {}; }
    refresh() {
        const stamp = existsSync(this.path) ? `${statSync(this.path).mtimeMs}:${statSync(this.path).size}` : 'missing';
        if (stamp !== this.stamp) { this.guilds = readJson(this.path, {}); this.stamp = stamp; }
    }
    get(guild, id) { this.refresh(); return { ...defaultRule(id), ...this.guilds[guild]?.[id] }; }
    all(guild) { return Object.fromEntries(EVENTS.map(event => [event.id, this.get(guild, event.id)])); }
    retired(guild) { this.refresh(); return Object.fromEntries(Object.entries(this.guilds[guild] ?? {}).filter(([id]) => !EVENT_IDS.has(id))); }
    save(guild, rules, library = soundLibrary(), retired = {}) {
        const clean = validateRules(rules, library);
        const ids = new Set(library.map(clip => clip.id));
        for (const [id, rule] of Object.entries(retired)) {
            if (EVENT_IDS.has(id) || !/^[a-z_]{1,60}$/.test(id) || typeof rule?.enabled !== 'boolean'
                || !['you','opponent','both'].includes(rule.side) || (rule.clips !== null && (!Array.isArray(rule.clips)
                    || rule.clips.length > 50 || rule.clips.some(clip => !ids.has(clip))))) throw Error('Invalid saved pool');
        }
        this.refresh(); atomicJson(this.path, { ...this.guilds, [guild]: { ...this.guilds[guild], ...clean, ...retired } }); this.stamp = null;
        return this.all(guild);
    }
}
