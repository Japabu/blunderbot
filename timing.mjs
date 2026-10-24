import { existsSync, readFileSync, statSync } from 'node:fs';
import { atomicJson } from './sound-rules.mjs';

export const TIMING_DEFAULTS = { bullet: 3, blitz: 5 };
export function validateTiming(value) {
    if (!value || Object.keys(value).length !== 2 || Object.keys(TIMING_DEFAULTS).some(key =>
        typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0.5 || value[key] > 120)) {
        throw Error('Waiting times must be between 0.5 and 120 seconds');
    }
    return { bullet: value.bullet, blitz: value.blitz };
}
export class TimingStore {
    constructor(path = './data/timing.json') { this.path = path; this.stamp = null; this.guilds = {}; }
    get(guild) {
        const stamp = existsSync(this.path) ? `${statSync(this.path).mtimeMs}:${statSync(this.path).size}` : 'missing';
        if (stamp !== this.stamp) {
            this.guilds = stamp === 'missing' ? {} : JSON.parse(readFileSync(this.path, 'utf8'));
            this.stamp = stamp;
        }
        return { ...TIMING_DEFAULTS, ...this.guilds[guild] };
    }
    save(guild, value) {
        const clean = validateTiming(value);
        this.get(guild);
        atomicJson(this.path, { ...this.guilds, [guild]: clean });
        this.stamp = null;
    }
}

export function waitingPlan(initial, speed, timing = TIMING_DEFAULTS) {
    if (!(initial > 0)) return [];
    // Prefer Lichess's actual speed classification, which also accounts for increments.
    const type = speed ?? (initial < 180 ? 'bullet' : initial < 600 ? 'blitz' : 'rapid');
    const think = initial < 180 ? 5 : initial < 600 ? 10 : 25;
    const wait = type === 'bullet' || type === 'ultraBullet' || type === 'blitz'
        ? timing[type === 'ultraBullet' ? 'bullet' : type]
        : Math.max(think * 2 + 5, initial * 0.15);
    // Early waiting music must not be interrupted by a later impatience line.
    return [
        ...(think < wait ? [{ seconds: think, commentary: 'think' }] : []),
        ...(think * 2 < wait ? [{ seconds: think * 2, commentary: 'hurry' }] : []),
        { seconds: wait, waiting: true },
    ];
}
