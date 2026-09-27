import 'dotenv/config';

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

import { AudioPlayerStatus, NoSubscriberBehavior, createAudioPlayer, createAudioResource, getVoiceConnection, joinVoiceChannel } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits, MessageFlags, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { formatReport } from './cheat.mjs';
import { getCurrentPlayerName, searchPlayers, stopWatching, watchPlayer } from './li.mjs';

// Each sound slot is a folder in sounds/, and a random clip from it plays
const BAD_SOUND_EFFECTS = [
	["blunder_queen", -800],
	["blunder_big", -300],
	["blunder_medium", -150],
	["blunder_small", -100],
	["blunder_tiny", -50],
]

const GOOD_SOUND_EFFECTS = [
	["great_move", 300],
	["good_move", 150],
]

// Clearly winning before the move, equal or worse after it
const THREW_WIN_BEFORE = 500;
const THREW_WIN_AFTER = 100;

// Think times (seconds) for "that was instant": a fast blunder is a misinput, a fast good move is gotta-go-fast
const MISINPUT_TIME = 1;
const MISINPUT_DELTA = -300;
const FAST_MOVE_TIME = 0.5;

// A move at least this bad plays its blunder sound even if it also captured something fun
const REAL_BLUNDER = -300;

// Waiting music stops as soon as the next move comes in
const WAITING_SLOTS = new Set(["opponent_slow", "you_slow"]);
// Time scramble music only gives way to the big moments
const BIG_SLOTS = new Set(["delivered_mate", "got_mated", "stalemated", "win_on_time", "misinput", "threw_win", "blunder_big", "blunder_queen", "lost_queen", "queen_trade"]);

process.on('unhandledRejection', error => {
	console.error('Unhandled promise rejection:', error);
});

const commands = [
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
await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });

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
	resumeSession();
});


const SOUND_POOLS = Object.fromEntries(readdirSync('./sounds', { withFileTypes: true })
	.filter(entry => entry.isDirectory())
	.map(entry => [entry.name, readdirSync(`./sounds/${entry.name}`).filter(file => file.endsWith('.mp3'))]));
const lastPlayed = {};
let nowPlaying = null;

const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });

// Plays a random clip of a slot, never the same one twice in a row
function play(slot) {
	const clips = SOUND_POOLS[slot] ?? [];
	if (!clips.length) return console.error('No sounds for', slot);
	if (nowPlaying === 'time_scramble' && !BIG_SLOTS.has(slot)) return;
	const choices = clips.length > 1 ? clips.filter(clip => clip !== lastPlayed[slot]) : clips;
	const clip = choices[Math.floor(Math.random() * choices.length)];
	lastPlayed[slot] = clip;
	nowPlaying = slot;
	console.log(`Sound: ${slot}/${clip}`);
	player.play(createAudioResource(`./sounds/${slot}/${clip}`));
}

// Dmitri Komarov's move- and square-specific lines (from the dmitlichess extension) for moves that got no
// meme sound. He never talks over another sound.
const KOMAROV = JSON.parse(readFileSync('./commentary/komarov/meta.json', 'utf8'));

function komarovKey(san) {
	const move = san.replace(/[+#]/g, '').replace(/=[QRBN]/, '');
	if (KOMAROV[move]) return move;
	// A capture without its own line falls back to the square: Bxc2 -> xc2
	if (move.indexOf('x') === 1 && KOMAROV[move.slice(1)]) return move.slice(1);
	if (san.includes('+')) return 'check';
}

function commentary(keyOrSan) {
	if (nowPlaying && !WAITING_SLOTS.has(nowPlaying)) return;
	const key = KOMAROV[keyOrSan] ? keyOrSan : komarovKey(keyOrSan);
	const clips = key && KOMAROV[key];
	if (!clips) return;
	const clip = clips[Math.floor(Math.random() * clips.length)];
	nowPlaying = 'komarov';
	console.log(`Komarov: ${key} (${clip})`);
	player.play(createAudioResource(`./commentary/komarov/${clip}`));
}

function moveSound(moveDelta, { before, after, thinkTime, flavor }) {
	const instant = limit => thinkTime !== null && thinkTime < limit;
	if (moveDelta <= MISINPUT_DELTA && instant(MISINPUT_TIME)) return "misinput";
	if (before >= THREW_WIN_BEFORE && after <= THREW_WIN_AFTER) return "threw_win";
	if (moveDelta <= REAL_BLUNDER) return BAD_SOUND_EFFECTS.find(([_, delta]) => moveDelta <= delta)?.[0];
	// Otherwise what happened on the board (a capture streak, a fork, ...) beats the engine's opinion
	if (flavor) return flavor;
	if (moveDelta < 0) return BAD_SOUND_EFFECTS.find(([_, delta]) => moveDelta <= delta)?.[0];

	const good = GOOD_SOUND_EFFECTS.find(([_, delta]) => moveDelta >= delta)?.[0];
	if (good && instant(FAST_MOVE_TIME)) return "fast_good_move";
	return good;
}

player.on('error', error => {
	console.error('AudioPlayerError:', error);
});
player.on(AudioPlayerStatus.Idle, () => {
	nowPlaying = null;
});

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
	const connection = joinVoiceChannel({
		channelId,
		guildId: guild.id,
		adapterCreator: guild.voiceAdapterCreator,
	});

	connection.on('stateChange', (oldState, newState) => {
		console.log(`Voice connection: ${oldState.status} -> ${newState.status}`);
	});
	connection.on('error', error => {
		console.error('Voice connection error:', error);
	});

	connection.subscribe(player);
	watchPlayer(username, {
		onMove: () => {
			if (WAITING_SLOTS.has(nowPlaying)) player.stop();
		},
		onMoveDelta: (moveDelta, info) => {
			const slot = moveSound(moveDelta, info);
			if (slot) play(slot);
			else commentary(info.san);
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
			play(summary.verdict === 'very sus' ? 'very_sus' : 'sus');
		},
		onGameEnd: (opponent, summary) => console.log('Game report:', formatReport(opponent, summary)),
	});
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
	} else if (interaction.commandName === "lichess") {
		const username = interaction.options.getString("username");
		console.log(username);

		const channelId = interaction.member?.voice?.channelId;
		if (!channelId) {
			await interaction.reply({ content: "Join a voice channel first, I need somewhere to play the sounds", flags: MessageFlags.Ephemeral });
			return;
		}

		startSpectating(interaction.guild, channelId, username);
		await interaction.reply("Spectating lichess player: " + username);
	} else if (interaction.commandName === "stop") {
		const playerName = getCurrentPlayerName();
		stopWatching();
		clearSession();
		getVoiceConnection(interaction.guildId)?.destroy();
		await interaction.reply(playerName ? "Stopped spectating lichess player: " + playerName : "Wasn't spectating anyone");
	}
}

client.login(process.env.TOKEN);
