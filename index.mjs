import 'dotenv/config';

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';

import { NoSubscriberBehavior, createAudioPlayer, createAudioResource, getVoiceConnection, joinVoiceChannel } from '@discordjs/voice';
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

// Semi-good moves only get a sound now and then, so it stays special
const OKAY_MOVE = 50;
const OKAY_MOVE_CHANCE = 0.15;
const OKAY_MOVE_COOLDOWN = 8; // of the watched player's moves

// Clearly winning before the move, equal or worse after it
const THREW_WIN_BEFORE = 500;
const THREW_WIN_AFTER = 100;

// Think times (seconds) for "that was instant": a fast blunder is a misinput, a fast good move is gotta-go-fast
const MISINPUT_TIME = 1;
const MISINPUT_DELTA = -300;
const FAST_MOVE_TIME = 0.5;

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

const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });

// Plays a random clip of a slot, never the same one twice in a row
function play(slot) {
	const clips = SOUND_POOLS[slot] ?? [];
	if (!clips.length) return console.error('No sounds for', slot);
	const choices = clips.length > 1 ? clips.filter(clip => clip !== lastPlayed[slot]) : clips;
	const clip = choices[Math.floor(Math.random() * choices.length)];
	lastPlayed[slot] = clip;
	console.log(`Sound: ${slot}/${clip}`);
	player.play(createAudioResource(`./sounds/${slot}/${clip}`));
}

function moveSound(moveDelta, { before, after, thinkTime }) {
	const instant = limit => thinkTime !== null && thinkTime < limit;
	if (moveDelta <= MISINPUT_DELTA && instant(MISINPUT_TIME)) return "misinput";
	if (before >= THREW_WIN_BEFORE && after <= THREW_WIN_AFTER) return "threw_win";
	if (moveDelta < 0) return BAD_SOUND_EFFECTS.find(([_, delta]) => moveDelta <= delta)?.[0];

	const good = GOOD_SOUND_EFFECTS.find(([_, delta]) => moveDelta >= delta)?.[0];
	if (good && instant(FAST_MOVE_TIME)) return "fast_good_move";
	if (good) return good;

	movesSinceOkay++;
	if (moveDelta >= OKAY_MOVE && movesSinceOkay >= OKAY_MOVE_COOLDOWN && Math.random() < OKAY_MOVE_CHANCE) {
		movesSinceOkay = 0;
		return "okay_move";
	}
}
let movesSinceOkay = OKAY_MOVE_COOLDOWN;

player.on('error', error => {
	console.error('AudioPlayerError:', error);
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
		onMoveDelta: (moveDelta, info) => {
			const slot = moveSound(moveDelta, info);
			if (slot) play(slot);
		},
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
