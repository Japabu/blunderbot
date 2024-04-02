import 'dotenv/config';

import { NoSubscriberBehavior, VoiceConnectionStatus, createAudioPlayer, createAudioResource, getVoiceConnection, getVoiceConnections, joinVoiceChannel } from '@discordjs/voice';
import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { getCurrentPlayerName, stopWatching, watchPlayerBlunders as watchPlayerMoves } from './li.mjs';

const BLUNDER_DELTA = -300;
const MISTAKE_DELTA = -150;
const OK_DELTA = 150;
const GOOD_DELTA = 300;

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


const blunderSound = () => createAudioResource('./sounds/blunder.mp3');
const mistakeSound = () => createAudioResource('./sounds/mistake.mp3');
const goodSound = () => createAudioResource('./sounds/good.mp3');
const okSound = () => createAudioResource('./sounds/ok.mp3');

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
			if (moveDelta < 0) {
				if (moveDelta <= BLUNDER_DELTA) {
					player.play(blunderSound());
				} else if (moveDelta <= MISTAKE_DELTA) {
					player.play(mistakeSound());
				}
			} else {
				if (moveDelta >= GOOD_DELTA) {
					player.play(goodSound());
				} else if(moveDelta >= OK_DELTA) {
					player.play(okSound());
				}
			}
		});
		await interaction.reply("Spectating lichess player: " + username);
	} else if (interaction.commandName === "stop") {
		await interaction.reply("Stopped spectating lichess player: " + getCurrentPlayerName());
		stopWatching();
		getVoiceConnection(interaction.guildId).destroy();
	}
});

client.login(process.env.TOKEN);