# 🎺 BlunderBot: The Chess Shame Machine

*Because every chess blunder deserves a wet fart sound effect*

## What is this monstrosity?

BlunderBot is a Discord bot that watches your Lichess games and provides **completely unnecessary** audio commentary on your chess moves. Think of it as that friend who laughs at your mistakes, except it's a robot and it never gets tired of your pain.

## Features That Nobody Asked For

- 🎵 **Real-time move analysis**: Uses Stockfish to judge your every decision
- 🔊 **Premium sound effects**: From wet farts for blunders to airhorns for brilliant moves
- 👀 **Stalker mode**: Watches your games like a chess-obsessed helicopter parent
- 🤖 **Discord integration**: Because shame is better when shared with friends

## Sound Effect Tier List

### When You Make a Good Move (+50 to +300 centipawns):
- 📯 **Airhorn** (+300): For when you accidentally play like Magnus
- 💰 **Price is Right** (+150): *Come on down!* You're the next contestant on "Not Terrible at Chess!"

### When You Blunder (-50 to -300 centipawns):
- 🎮 **Minecraft Damage** (-50): *Oof* but pixelated
- 😤 **Bruh** (-100): The universal sound of disappointment
- 🤕 **Roblox Oof** (-150): Death sound for your position
- 💨 **Wet Fart** (-300): For when you really, *really* messed up

## Setup (If You Dare)

1. **Prerequisites**: 
   - Node.js (because JavaScript is the only language that makes sense for chaos)
   - A Discord bot token (steal one from Discord's cookie jar)
   - A Stockfish server (or use someone else's, we won't tell)
   - The ability to handle public humiliation

2. **Installation**:
   ```bash
   npm install
   # Install your shame
   ```

3. **Configuration**:
   - Copy your Discord bot token to `.env` (it's already there, you're welcome)
   - Set up your `STOCKFISH_SERVER_URL` because we're too lazy to run Stockfish locally
   - Invite the bot to your server and give it voice channel permissions

4. **Run the shame machine**:
   ```bash
   npm start
   # Let the roasting begin
   ```

## Commands

- `/lichess <username>` - Start stalking a Lichess player (with their consent, hopefully)
- `/stop` - Stop the madness (coward)
- `/ping` - Check if the bot is alive and ready to judge you

## How It Works (The Magic Behind the Misery)

1. **Stalking Phase**: Bot polls Lichess API every 3 seconds to see if you're playing
2. **Connection Phase**: Opens WebSocket to your game like a chess paparazzi
3. **Analysis Phase**: Feeds your moves to Stockfish for professional judgment
4. **Shame Phase**: Calculates move quality and plays appropriate sound effect
5. **Repeat**: Until you rage quit or achieve chess enlightenment

## Cheater Detection (Is Your Opponent Suspiciously Good?)

The bot also judges your opponent. Every opponent move after the opening is scored by Stockfish (skipping positions that are already decided), and their **average centipawn loss** is compared to what's normal for their rating. Engine top-move agreement and throwaway accounts (< 30 days old or < 50 games) push the needle further.

- Mid-game: once they look sus, the bot says so in the channel you ran `/lichess` from and plays the *sus* sound in voice
- Game end (or `/stop`): a report with ACPL, expected ACPL, engine match %, and a verdict
- Game start: an instant heads-up if Lichess already marked the opponent for a ToS violation

It's one game and a depth 8 engine, so treat "sus" as vibes, not proof. `STOCKFISH_DEPTH` raises the search depth if your hardware can take it.

## Technical Details (For the Nerds)

- Built with Discord.js because we hate ourselves
- Uses Lichess WebSocket API for real-time game data
- Stockfish evaluation via HTTP API (because running engines is hard)
- Audio playback through Discord voice channels
- Dockerized for easy deployment to the cloud of shame

## Contributing

Found a bug? Want to add more humiliating sound effects? PRs welcome! Just remember:
- Keep it family-friendly (ish)
- Test your changes (unlike your chess moves)
- Add more sound effects for different centipawn ranges
- Make the bot even more judgmental

## Disclaimer

This bot may cause:
- Hurt feelings
- Improved chess play (through fear)
- Uncontrollable laughter from your Discord friends
- Existential crisis about your chess abilities
- Addiction to the sweet sound of airhorns

Use responsibly. The creators are not responsible for any chess rage, broken keyboards, or damaged egos.

## License

MIT License - Because even shame should be open source.

---

*"In chess, as in life, every move is an opportunity to disappoint yourself publicly."* - BlunderBot, probably
