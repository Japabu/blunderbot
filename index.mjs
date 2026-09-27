import 'dotenv/config';

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { NoSubscriberBehavior, createAudioPlayer, createAudioResource, getVoiceConnection, joinVoiceChannel } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits, MessageFlags, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { formatReport } from './cheat.mjs';
import { getCurrentPlayerName, searchPlayers, stopWatching, watchPlayer } from './li.mjs';

const BAD_SOUND_EFFECTS = [
	["vine_boom", -800], // about a queen
	["wet_fart", -300],
	["oof", -150],
	["bruh", -100],
	["minecraft_damage", -50],
]

const GOOD_SOUND_EFFECTS = [
	["airhorn", 300],
	["price", 150],
]

const MOMENT_SOUNDS = {
	en_passant: "en_passant",
	delivered_mate: "mission_passed",
	got_mated: "emotional_damage",
	stalemated: "sad_trombone",
}

// Clearly winning before the move, equal or worse after it
const THREW_WIN_BEFORE = 500;
const THREW_WIN_AFTER = 100;

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


const loadSound = (name) => createAudioResource(`./sounds/${name}.mp3`);
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });

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
	const play = name => player.play(loadSound(name));
	watchPlayer(username, {
		onMoveDelta: (moveDelta, { before, after }) => {
			let soundName;
			if (before >= THREW_WIN_BEFORE && after <= THREW_WIN_AFTER) {
				soundName = "faah";
			} else if (moveDelta < 0) {
				soundName = BAD_SOUND_EFFECTS.find(([_, delta]) => moveDelta <= delta)?.[0];
			} else {
				soundName = GOOD_SOUND_EFFECTS.find(([_, delta]) => moveDelta >= delta)?.[0];
			}

			if (soundName) play(soundName);
		},
		onMoment: moment => play(MOMENT_SOUNDS[moment]),
		// Cheat reports only go to the log; the voice channel just hears sus (and X-Files once it's very sus)
		onGameStart: opponent => {
			if (opponent.account?.tosViolation) play('sus');
		},
		onCheatAlert: (opponent, summary) => {
			console.log('Cheat alert:', formatReport(opponent, summary));
			play(summary.verdict === 'very sus' ? 'x_files' : 'sus');
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
