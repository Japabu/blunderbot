import 'dotenv/config';

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, watchFile, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { AudioPlayerStatus, NoSubscriberBehavior, StreamType, createAudioPlayer, createAudioResource, getVoiceConnection, joinVoiceChannel } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits, MessageFlags, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { formatReport } from './cheat.mjs';
import { getCurrentPlayerName, latestMoveWasMine, moveReceivedAt, requestBrainCue, searchPlayers, stopWatching, watchPlayer } from './li.mjs';
import { SettingsStore } from './settings.mjs';
import { BOT_DEFAULTS, soundEnabled } from './sound-settings.mjs';
import { HandAndBrain, PIECE_NAMES } from './hand-and-brain.mjs';
import { watchVoiceConnection } from './voice.mjs';
import { InactivityTimer } from './inactivity.mjs';
import { SoundRules, eventFor, atomicJson } from './sound-rules.mjs';
import { classifyMove } from './move-quality.mjs';

const settingsStore = new SettingsStore('./data/settings.json', BOT_DEFAULTS);
let activeGuildId = null;
const soundRules = new SoundRules();
const enabled = (slot, gameOver = false, mine = latestMoveWasMine()) => soundEnabled(settingsStore.get(activeGuildId), slot, mine, gameOver, soundRules.get(activeGuildId, slot));
const brainEnabled = () => settingsStore.get(activeGuildId).hand_and_brain;

// Waiting music stops as soon as the next move comes in
const WAITING_SLOTS = new Set(["opponent_slow", "you_slow"]);
// Time scramble music only gives way to the big moments
const BIG_SLOTS = new Set(["won_game", "lost_game", "stalemated", "misinput", "threw_win", "blunder_big", "blunder_queen", "lost_queen", "queen_trade"]);

process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

const commands = [
	new SlashCommandBuilder()
		.setName('config')
		.setDescription('Show or change saved sound settings and hand-and-brain mode')
		.addBooleanOption(option => option.setName('dimitri').setDescription('Dimitri Komarov commentary'))
		.addBooleanOption(option => option.setName('good_moves').setDescription('Good and great move sounds'))
		.addBooleanOption(option => option.setName('bad_moves').setDescription('Blunder, misinput and thrown win sounds'))
		.addBooleanOption(option => option.setName('misc').setDescription('Captures, results, clocks and all other sounds'))
		.addBooleanOption(option => option.setName('hand_and_brain').setDescription('Standard chess: the bot names a piece with a strong move; you choose the move')),
	new SlashCommandBuilder()
		.setName('ping')
		.setDescription('Replies with Ponggg!'),
	new SlashCommandBuilder()
		.setName('lichess')
		.setDescription('Stalks a lichess user and comments on their moves')
		.addStringOption(option => option
			.setName("username")
			.setDescription("Lichess username")
			.setRequired(true)
			.setAutocomplete(true)
		),
	new SlashCommandBuilder()
		.setName('stop')
		.setDescription('Stops stalking a lichess user')
];

const rest = new REST().setToken(process.env.TOKEN);
const configCommand = commands.find(command => command.name === 'config').toJSON();
// Configuration belongs to a server. Guild registration also makes changes visible immediately.
await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands.filter(command => command.name !== 'config') });

async function registerServerConfig(guild) {
	try {
		let guilds = {};
		try { guilds = JSON.parse(readFileSync('./data/guilds.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
		atomicJson('./data/guilds.json', { ...guilds, [guild.id]: guild.name });
		await rest.post(Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id), { body: configCommand });
		console.log(`Registered /config in ${guild.name}`);
	} catch (error) {
		console.error(`Could not register /config in ${guild.name}:`, error);
	}
}

const client = new Client({ intents: [GatewayIntentBits.Guilds | GatewayIntentBits.GuildVoiceStates] });

client.on(Events.ShardError, error => {
	console.error('A websocket connection encountered an error:', error);
});
client.on(Events.Error, error => {
	console.error('ERR:', error);
});
client.on(Events.Warn, error => {
	console.error('WARN:', error);
});

client.on(Events.ClientReady, () => {
	console.log(`Logged in as ${client.user.tag}!`);
	for (const guild of client.guilds.cache.values()) void registerServerConfig(guild);
	resumeSession();
});
client.on(Events.GuildCreate, registerServerConfig);


const SOUND_POOLS = Object.fromEntries(readdirSync('./sounds', { withFileTypes: true })
	.filter(entry => entry.isDirectory())
	.map(entry => [entry.name, readdirSync(`./sounds/${entry.name}`).filter(file => file.endsWith('.ogg'))]));
const lastPlayed = {};
let nowPlaying = null;
// Profiling: what was last handed to the player, and when (performance.now() ms)
let pending = null;

const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
const brain = new HandAndBrain({
	enabled: brainEnabled,
	speak: piece => {
		nowPlaying = 'hand_and_brain';
		console.log(`Hand and brain: ${piece}`);
		startPlaying(`hand-and-brain/${piece}`, `./commentary/hand-and-brain/${piece}.ogg`);
	},
});

watchFile('./data/settings.json', { interval: 1000, persistent: false }, () => {
	if (!activeGuildId) return;
	brain.reset();
	if (nowPlaying === 'hand_and_brain' || (nowPlaying && !enabled(nowPlaying))) player.stop();
	requestBrainCue();
});
watchFile('./data/sound-rules.json', { interval: 1000, persistent: false }, () => {
	if (activeGuildId && nowPlaying && nowPlaying !== 'hand_and_brain' && !enabled(nowPlaying)) player.stop();
});

// Plays a random clip of a slot, never the same one twice in a row
function play(slot, { gameOver = false, mine = latestMoveWasMine() } = {}) {
	// A piece cue takes priority over blunder feedback; the next cue can also interrupt a meme clip.
	if (!gameOver && brainEnabled() && nowPlaying === 'hand_and_brain') return false;
	if (!enabled(slot, gameOver, mine)) return false;
	const rule = soundRules.get(activeGuildId, slot);
	const pool = eventFor(slot)?.pool ?? slot;
	const clips = rule.clips === null ? (SOUND_POOLS[pool] ?? []).map(clip => `${pool}/${clip}`) : rule.clips;
	if (!clips.length) return console.error('No sounds for', slot);
	if (nowPlaying === 'time_scramble' && !BIG_SLOTS.has(slot)) return;
	const choices = clips.length > 1 ? clips.filter(clip => clip !== lastPlayed[slot]) : clips;
	const clip = choices[Math.floor(Math.random() * choices.length)];
	lastPlayed[slot] = clip;
	nowPlaying = slot;
	const path = clip.startsWith('custom/') ? `./data/${clip}` : `./sounds/${clip}`;
	console.log(`Sound: ${slot} → ${clip}`);
	startPlaying(`${slot}/${clip}`, path);
	return true;
}

// Dmitri Komarov's move- and square-specific lines (from the dmitlichess extension) for moves that got no
// meme sound. He never talks over another sound.
const KOMAROV = JSON.parse(readFileSync('./commentary/komarov/meta.json', 'utf8'));

// Every clip is Ogg Opus, what Discord streams anyway, and kept in memory: that way playback needs no ffmpeg
// and no SD card read, which took 300-800 ms per sound on the Pi
const clipCache = new Map();

// Warm the cache in the background: reading all ~1500 clips off the Pi's SD card takes ~35 s, and the bot
// shouldn't wait for that (a clip that isn't cached yet is read on demand in a few ms)
(async () => {
	const started = performance.now();
	const paths = [
		...Object.entries(SOUND_POOLS).flatMap(([slot, clips]) => clips.map(clip => `./sounds/${slot}/${clip}`)),
		...Object.values(KOMAROV).flat().map(clip => `./commentary/komarov/${clip}`),
		...[...Object.values(PIECE_NAMES), 'wrong_piece'].map(piece => `./commentary/hand-and-brain/${piece}.ogg`),
	];
	for (const path of paths) if (!clipCache.has(path)) clipCache.set(path, await readFile(path));
	console.log(`Cached ${clipCache.size} clips in ${Math.round((performance.now() - started) / 1000)} s`);
})().catch(error => console.error('Clip preload failed:', error));

function komarovKey(san) {
	const move = san.replace(/[+#]/g, '').replace(/=[QRBN]/, '');
	if (KOMAROV[move]) return move;
	// A capture without its own line falls back to the square: Bxc2 -> xc2
	if (move.indexOf('x') === 1 && KOMAROV[move.slice(1)]) return move.slice(1);
	if (san.includes('+')) return 'check';
}

function commentary(keyOrSan) {
	if (brainEnabled()) return;
	if (!enabled('komarov')) return;
	if (nowPlaying && !WAITING_SLOTS.has(nowPlaying)) return;
	const key = KOMAROV[keyOrSan] ? keyOrSan : komarovKey(keyOrSan);
	const clips = key && KOMAROV[key];
	if (!clips) return;
	const clip = clips[Math.floor(Math.random() * clips.length)];
	nowPlaying = 'komarov';
	console.log(`Komarov: ${key} (${clip})`);
	startPlaying(`komarov/${clip}`, `./commentary/komarov/${clip}`);
}

function moveSound(moveDelta, { before, after, thinkTime, flavor, bestmove, uci }) {
	// Let the guaranteed reload finish instead of cutting it off with a fast engine verdict.
	if (['attack_up', 'discovery'].includes(flavor) && enabled(flavor)) return flavor;
	const quality = classifyMove({ before, after, thinkTime, bestmove, uci });
	if (quality?.grade === 'blunder' && enabled(quality.slot)) return quality.slot;
	// Otherwise what happened on the board (a capture, a fork, ...) beats the engine's opinion
	if (flavor && enabled(flavor)) return flavor;
	return quality?.slot;
}

player.on('error', error => {
	console.error('AudioPlayerError:', error);
});
player.on(AudioPlayerStatus.Idle, () => {
	nowPlaying = null;
});
player.on(AudioPlayerStatus.Playing, () => {
	if (!pending) return;
	const now = performance.now();
	const sinceMove = pending.moveAt ? `, ${Math.round(now - pending.moveAt)} ms after the move arrived` : '';
	console.log(`[timing] ${pending.name} playing ${Math.round(now - pending.at)} ms after play()${sinceMove}`);
	pending = null;
});

function startPlaying(name, path) {
	pending = { name, at: performance.now(), moveAt: moveReceivedAt() };
	if (!clipCache.has(path)) clipCache.set(path, readFileSync(path));
	player.play(createAudioResource(Readable.from([clipCache.get(path)]), { inputType: StreamType.OggOpus }));
}

// The watched player and voice channel survive restarts (every deploy restarts the container)
const SESSION_FILE = './data/session.json';

function saveSession(session) {
	try {
		mkdirSync('./data', { recursive: true });
		writeFileSync(SESSION_FILE, JSON.stringify(session));
	} catch (error) {
		console.error('Could not save session:', error);
	}
}

function clearSession() {
	rmSync(SESSION_FILE, { force: true });
}

const inactivity = new InactivityTimer(() => {
	console.log('Disconnecting from voice after inactivity');
	stopSpectating();
});

function stopSpectating() {
	inactivity.stop();
	stopWatching();
	brain.reset();
	player.stop();
	clearSession();
	getVoiceConnection(activeGuildId)?.destroy();
	activeGuildId = null;
}

async function resumeSession() {
	if (!existsSync(SESSION_FILE)) return;
	try {
		const { guildId, channelId, username } = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
		const guild = await client.guilds.fetch(guildId);
		console.log(`Resuming: spectating ${username}`);
		startSpectating(guild, channelId, username);
	} catch (error) {
		console.error('Could not resume session:', error);
	}
}

function startSpectating(guild, channelId, username) {
	if (activeGuildId && activeGuildId !== guild.id) stopSpectating();
	inactivity.start();
	brain.reset();
	player.stop();
	activeGuildId = guild.id;
	const connection = joinVoiceChannel({
		channelId,
		guildId: guild.id,
		adapterCreator: guild.voiceAdapterCreator,
	});

	watchVoiceConnection(connection, { onRecovered: () => {
		// Drop clips queued while disconnected and announce the current position again.
		player.stop();
		brain.reset();
		requestBrainCue();
	} });

	connection.subscribe(player);
	watchPlayer(username, {
		wantsBrainCue: brainEnabled,
		onGameActivity: active => inactivity.activity(active),
		onPosition: position => {
			brain.setPosition(position);
			if (!position && nowPlaying === 'hand_and_brain') player.stop();
		},
		onPositionAnalysis: (position, analysis) => brain.analyzed(position, analysis),
		onMove: move => {
			player.stop(true);
			brain.moved(move);
		},
		// Right away: a board effect (capture, fork, ...) or Komarov announcing the move
		onMoveInstant: ({ san, flavor, mine }) => {
			if (!flavor || !play(flavor, { mine })) commentary(san);
		},
		// Once the engine is done: only cut in if the verdict is something other than what's already playing
		onMoveDelta: (moveDelta, info) => {
			const slot = moveSound(moveDelta, info);
			if (slot && slot !== info.flavor) play(slot);
		},
		onCommentary: commentary,
		// Moments are named after their sound slot
		onMoment: moment => play(moment),
		// Cheat reports only go to the log; the voice channel just hears sus (and X-Files once it's very sus)
		onGameStart: opponent => {
			if (opponent.account?.tosViolation) play('sus');
		},
		onCheatAlert: (opponent, summary) => {
			console.log('Cheat alert:', formatReport(opponent, summary));
		},
		onGameLoss: () => {
			brain.reset();
			play('lost_game', { gameOver: true });
		},
		onGameWin: () => {
			brain.reset();
			play('won_game', { gameOver: true });
		},
		onGameEnd: (opponent, summary) => console.log('Game report:', formatReport(opponent, summary)),
	});
	requestBrainCue();
	saveSession({ guildId: guild.id, channelId, username });
}

client.on(Events.InteractionCreate, async interaction => {
	try {
		await handleInteraction(interaction);
	} catch (error) {
		console.error('Interaction error:', error);
	}
});

async function handleInteraction(interaction) {
	if (interaction.isAutocomplete()) {
		if (interaction.commandName === 'lichess') {
			const focusedValue = interaction.options.getFocused();
			const usernames = await searchPlayers(focusedValue);

			// Convert to Discord autocomplete format
			const choices = usernames.map(username => ({
				name: username,
				value: username
			}));

			await interaction.respond(choices);
		}
		return;
	}

	if (!interaction.isChatInputCommand()) return;

	if (interaction.commandName === "ping") {
		await interaction.reply("Pong!");
	} else if (interaction.commandName === 'config') {
		if (!interaction.guildId) {
			await interaction.reply({ content: 'Use this command in a server.', flags: MessageFlags.Ephemeral });
			return;
		}
		const previous = settingsStore.get(interaction.guildId);
		const changes = Object.fromEntries(Object.keys(BOT_DEFAULTS)
			.map(key => [key, interaction.options.getBoolean(key)]).filter(([, value]) => value !== null));
		const settings = Object.keys(changes).length
			? settingsStore.update(interaction.guildId, changes) : settingsStore.get(interaction.guildId);
		if (activeGuildId === interaction.guildId) {
			if (previous.hand_and_brain !== settings.hand_and_brain) {
				player.stop();
				brain.reset();
				requestBrainCue();
			} else if (nowPlaying && nowPlaying !== 'hand_and_brain' && !enabled(nowPlaying)) player.stop();
		}
		await interaction.reply({
			content: `Settings (saved for this server):\n${Object.entries(settings).map(([key, value]) => `${key}: **${value ? 'on' : 'off'}**`).join('\n')}`
				+ (settings.hand_and_brain ? '\n\nHand and brain: I name a piece on your turn; you choose its move. Bad-move sounds follow bad_moves; game-result sounds follow misc.' : ''),
			flags: MessageFlags.Ephemeral,
		});
	} else if (interaction.commandName === "lichess") {
		const username = interaction.options.getString("username");
		console.log(username);

		const channelId = interaction.member?.voice?.channelId;
		if (!channelId) {
			await interaction.reply({ content: "Join a voice channel first, I need somewhere to play the sounds", flags: MessageFlags.Ephemeral });
			return;
		}

		startSpectating(interaction.guild, channelId, username);
		await interaction.reply("Spectating lichess player: " + username + (brainEnabled() ? '\nHand and brain is on: wait for a piece name, then choose a move with that piece.' : ''));
	} else if (interaction.commandName === "stop") {
		const playerName = getCurrentPlayerName();
		stopSpectating();
		await interaction.reply(playerName ? "Stopped spectating lichess player: " + playerName : "Wasn't spectating anyone");
	}
}

client.login(process.env.TOKEN);
