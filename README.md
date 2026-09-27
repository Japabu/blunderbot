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

Every slot is a folder in `sounds/` and a random clip from it plays (never the same one twice in a row), so drop more clips in to add variety. Clips are Ogg Opus, the format Discord streams, and preloaded into memory, so a sound starts within milliseconds instead of waiting for ffmpeg: convert with `npx ffmpeg-static` or any ffmpeg, e.g. `ffmpeg -i clip.mp3 -af loudnorm=I=-12 -c:a libopus -b:a 96k -ar 48000 -ac 2 clip.ogg`.

Anything that can be read off the board (captures, forks, en passant, checkmate, ...) or Komarov announcing the move plays the instant a move arrives. The engine's verdict comes a few hundred milliseconds later and only cuts in when it has something better to say, like a blunder.

### When You Make a Good Move:
- 💰 **good_move** (+150): Price is Right, "Okay let's go", anime wow, Owen Wilson *wow*
- 📯 **great_move** (+300): Airhorn, MLG airhorn, "Oh baby a triple", Hallelujah
- 🦔 **fast_good_move**: a good move played instantly gets Sonic's *gotta go fast*

### When You Blunder:
- 🎮 **blunder_tiny** (-50): Minecraft damage, huh cat
- 😤 **blunder_small** (-100): Bruh, Taco Bell bong
- 🤕 **blunder_medium** (-150): Roblox oof, SpongeBob fail
- 💨 **blunder_big** (-300): Wet fart, Windows XP shutdown
- 💥 **blunder_queen** (-800): Vine boom
- ⌨️ **misinput**: a big blunder played within a second. *IT WAS A MISINPUT, CALM DOWN*
- 😩 **threw_win**: you were clearly winning (+5) and now you're not: faah, Curb Your Enthusiasm

### Special Moments:
- 🔔 **game_start**: Boxing bell, as soon as the bot finds the new game
- 🌸 **en_passant**: Anime ahh (by anyone, because it's always an event)
- 🍄 **promotion**: Mario power-up, and 🏃 **knight_promotion** (anyone): *why are you running?*
- ✋ **check_spam**: your third check in a row: *stop, stop, he's already dead*
- 🤷 **opponent_blunder**: they hang something big: *oh no... anyway*
- 🏆 **delivered_mate**: GTA mission passed, FF7 victory fanfare, We Are the Champions
- 💔 **got_mated**: Emotional damage, *YOU DIED*, coffin dance, Mario death, Käsiger Michael
- 🧀 **lost_game**: lost by resignation, on time or abandoning: Käsiger Michael
- 🎺 **stalemated**: you stalemated them: sad trombone, *directed by Robert B. Weide*
- ⏱️ **win_on_time**: *to be continued*

### Captures (no engine needed, and they beat the good/bad move sound unless it's a real blunder):
- 🩸 **first_blood**: first capture of the game
- ⚔️ **double_kill** / **triple_kill** / **quadra_kill** / **penta_kill**: you capture on 2, 3, 4, 5 moves in a row, and 😈 **opponent_double_kill** when they do it twice
- 🎯 **headshot**: a bishop, rook or queen snipes something from 5+ squares away
- 😭 **lost_queen**: they take your queen: *NOOOOO*, and 👋 **queen_trade**: *bye, have a great time* / sayonara
- 🚪 **king_capture**: the king takes something: *I am the one who knocks*
- 💀 **bloodbath**: four captures in a row: *FATALITY*
- 🍴 **fork**: a knight attacks the king and the queen or a rook at once: *surprise*

### Clock:
- 🤔 Komarov gets impatient on long thinks (10 s in blitz, 5 s in bullet, 25 s in rapid): *"what to play"*, *"hmm"*, *"thinking now thinking"*, and twice that long in: *"need to make move"*, *"time running"*, *"zeitnot"*
- 🎵 **opponent_slow**: they've been thinking for 15% of the base time: Jeopardy, elevator music, snoring (stops as soon as they move)
- 👨‍🍳 **you_slow**: you're the one thinking that long: *let him cook*
- 🎷 **time_scramble**: both clocks under 10 seconds: Yakety Sax (only big moments interrupt it)
- 🤨 **sus** / 👽 **very_sus**: your opponent is playing suspiciously well / *very* suspiciously well (see below)

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

## Dmitri Komarov Commentary

Every move that doesn't get a meme sound (yours and your opponent's) gets GM Dmitri Komarov announcing it instead: *"Knight c3!"*, captures by their square, castling, checks, plus his lines for draws and your opponent resigning. Only his move- and square-specific lines are used, never the random filler, and he never talks over another sound. The ~1400 clips come from Vincent Simard's [dmitlichess](https://github.com/vincentsimard/dmitlichess) extension (WTFPL), levelled a bit quieter than the memes, in `commentary/komarov/`. When the bot joins a game that's already running, the moves Lichess replays on connect stay silent.

## Cheater Detection (Is Your Opponent Suspiciously Good?)

The bot also judges your opponent. Every opponent move after the opening is scored by Stockfish (skipping positions that are already decided), and a *sus* sound plays in voice when they look engine-assisted (and the X-Files theme when it gets worse):

- **Too accurate for their rating**: average centipawn loss compared to what's normal at their rating *and* time control (bullet players blunder more than rapid players at the same rating)
- **Engine top move** way too often
- **Robotic move times**: humans premove recaptures and burn clock on critical moves, engine copiers take the same few seconds for everything (ignored in bullet and time scrambles)
- **Throwaway account** (< 30 days old or < 50 games) nudges it further, and a Lichess ToS mark plays *sus* at game start

It plays *sus* when the verdict turns suspicious and the X-Files theme if it turns very suspicious. No chat spam: the numbers (ACPL, expected ACPL, engine match %, think-time CV, verdict) only go to the bot's log. The thresholds come from replaying real games of normal players and of Lichess-marked accounts (~5% of honest games trip it), so treat *sus* as vibes, not proof. `STOCKFISH_DEPTH` raises the search depth if your hardware can take it.

`/lichess` survives bot restarts: the spectated player and voice channel are kept in `data/session.json`.

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
