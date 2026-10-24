import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Only known boolean settings are read, so old files remain compatible as settings are added.
export class SettingsStore {
	constructor(path, defaults) {
		this.path = path;
		this.defaults = defaults;
		try {
			this.guilds = JSON.parse(readFileSync(path, 'utf8'));
			if (!this.guilds || typeof this.guilds !== 'object' || Array.isArray(this.guilds)) throw new Error('Expected a settings object');
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
			this.guilds = {};
		}
		this.stamp = null;
	}

	get(guildId) {
		// The local control room writes this same durable file. Read it again so edits
		// apply on the next event without restarting Discord or losing a game.
		try {
			const stamp = statSync(this.path).mtimeMs;
			if (stamp !== this.stamp) {
				const guilds = JSON.parse(readFileSync(this.path, 'utf8'));
				if (!guilds || typeof guilds !== 'object' || Array.isArray(guilds)) throw Error('Expected a settings object');
				this.guilds = guilds; this.stamp = stamp;
			}
		}
		catch (error) { if (error.code !== 'ENOENT') throw error; }
		return Object.fromEntries(Object.entries(this.defaults).map(([key, value]) =>
			[key, typeof this.guilds[guildId]?.[key] === 'boolean' ? this.guilds[guildId][key] : value]));
	}

	update(guildId, changes) {
		const next = { ...this.get(guildId) };
		for (const [key, value] of Object.entries(changes)) {
			if (Object.hasOwn(this.defaults, key) && typeof value === 'boolean') next[key] = value;
		}
		const guilds = { ...this.guilds, [guildId]: next };
		mkdirSync(dirname(this.path), { recursive: true });
		const temporary = `${this.path}.${process.pid}.tmp`;
		writeFileSync(temporary, JSON.stringify(guilds, null, 2));
		renameSync(temporary, this.path);
		this.guilds = guilds;
		this.stamp = statSync(this.path).mtimeMs;
		return next;
	}
}
