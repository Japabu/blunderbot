import 'dotenv/config';

import { NoSubscriberBehavior, VoiceConnectionStatus, createAudioPlayer, createAudioResource, getVoiceConnection, getVoiceConnections, joinVoiceChannel } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { getCurrentPlayerName, stopWatching, watchPlayerBlunders as watchPlayerMoves } from './li.mjs';

const BAD_SOUND_EFFECTS = [
	["wet_fart", -300],
	["oof", -150],
	["bruh", -100],
	["minecraft_damage", -50],
]

const GOOD_SOUND_EFFECTS = [
	["airhorn", 300],
	["price", 150],
]

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
});


const loadSound = (name) => createAudioResource(`./sounds/${name}.mp3`);
const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });

player.on('error', error => {
	console.error('AudioPlayerError:', error);
});

client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;

	if (interaction.commandName === "ping") {
		await interaction.reply("Pong!");
	} else if (interaction.commandName === "lichess") {
		const username = interaction.options.getString("username");
		console.log(username);

		const connection = joinVoiceChannel({
			channelId: interaction.member.voice.channel.id,
			guildId: interaction.guild.id,
			adapterCreator: interaction.guild.voiceAdapterCreator,
		});

		connection.on(VoiceConnectionStatus.Ready, () => {
			console.log('The connection has entered the Ready state - ready to play audio!');
		});

		connection.subscribe(player);
		watchPlayerMoves(username, moveDelta => {
			let soundName;
			if (moveDelta < 0) {
                soundName = BAD_SOUND_EFFECTS.find(([_, delta]) => moveDelta <= delta)?.[0];
            } else {
                soundName = GOOD_SOUND_EFFECTS.find(([_, delta]) => moveDelta >= delta)?.[0];
            }

			if (soundName) player.play(loadSound(soundName));
		});
		await interaction.reply("Spectating lichess player: " + username);
	} else if (interaction.commandName === "stop") {
		await interaction.reply("Stopped spectating lichess player: " + getCurrentPlayerName());
		stopWatching();
		getVoiceConnection(interaction.guildId).destroy();
	}
});

client.login(process.env.TOKEN);