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

Your move gets one reaction after analysis: verified brilliant/great, otherwise a mistake, otherwise a meaningful board event. Opponent special moves can react immediately. Normal moves get no sound effect; optional Dimitri commentary follows its own switch. Win/loss reactions wait for Lichess to confirm the result and play once. The engine's verdict comes a few hundred milliseconds later and only cuts in when it has something better to say, like a blunder.

### Move quality

Moves are graded against the engine evaluation immediately before that move, from the mover's perspective. An opponent's blunder no longer earns a positive reaction by itself. The old comparison against the watched player's previous turn and the fast-good-move category have been removed.

The bands follow [Chess.com's published classifications](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-etc), using [Lichess's public win-chance conversion](https://lichess.org/page/accuracy), `1 / (1 + exp(-0.00368208 * cp))`. This is a transparent approximation, not Chess.com's private rating-adjusted expected-points model. Normal grading reuses adjacent searches. Optional Great detection requests two lines only on your turns; candidates receive finite depth-12+ confirmation. Brilliant detection additionally checks legal capture/recapture material and every profitable acceptance of the principal offered piece (up to three). It rejects already-easily-winning alternatives and sacrifices that leave you worse than −0.5 or lose over two percentage points. There is no pondering or background engine work. Disabling good_moves or its specific event stops that verification. Normal good, excellent and best moves stay quiet. Great moves must be uniquely strong, and Brilliant moves must contain a sound piece or exchange sacrifice.

| Grade | Winning chances lost | Sound pool |
| --- | --- | --- |
| Brilliant | Verified sound piece/exchange sacrifice | brilliant_move (defaults to great_move clips) |
| Great | Verified only-good move: next option loses at least 10 points | great_move |
| Normal best / excellent / good | Under 5 points lost | No sound |
| Inaccuracy | 5–10 points | blunder_tiny |
| Mistake | 10–20 points | blunder_small |
| Blunder | 20–30 points | blunder_medium |
| Big blunder | 30–45 points | blunder_big |
| Huge blunder | 45+ points | blunder_queen |

A blunder played within one second uses `misinput`. Losing at least 10 percentage points while going from +5 or better to +1 or worse uses `threw_win` (unless it is an instant blunder). Missing/stale before-position analysis never produces a guessed grade.

Suspected inaccuracies, mistakes and blunders are confirmed with depth-12+ before/after searches before playing a bad sound. Existing deeper searches are reused. Ordinary moves receive no extra grading searches; cancelled or failed confirmation stays silent. Confirmed results are also reconciled from the game export when status polling loses the playing ID or the socket misses result details.

Obvious immediate recaptures do not earn Great, even when all other moves lose material. Brilliant sacrifices and specific board events still have their separate checks.

### Special Moments:
- 🔔 **game_start**: Boxing bell, as soon as the bot finds the new game
- 🌸 **en_passant**: Anime ahh (either player, according to its rule)
- 🍄 **promotion**: Mario power-up, and 🏃 **knight_promotion** (anyone): *why are you running?*
- ✋ **check_spam**: a player’s third check in a row: *stop, stop, he's already dead*
- 🏆 **won_game**: a random win reaction: Gran Turismo 4's failed-test music, GTA mission passed, FF7 victory fanfare, We Are the Champions, or *to be continued*. Plays once per confirmed win, including checkmate, resignation, timeout, or abandonment; follows `misc` and also works in hand-and-brain mode. Never repeats the previous win clip immediately.
- 💔 **lost_game**: a random loss reaction: *Du bist gut genug*, Emotional Damage, *YOU DIED*, coffin dance, Mario death, or Käsiger Michael. Picks one clip per confirmed loss without repeating the previous clip. Covers checkmate, resignation, running out of time, and abandonment; follows `misc` and also works in hand-and-brain mode. This game-result sound can play after the opponent's final move; special-move sounds follow their separate player rules.
- 🎺 **stalemated**: you stalemated them: sad trombone, *directed by Robert B. Weide*

### Board events (bad-move reactions take priority):
- 🔫 **attack_up**: *Reload Gun Sound* when your move creates a legal attack on a higher-value enemy piece: pawn < knight/bishop < rook < queen. Includes discovered attacks; king attacks, equal-value trades, pawn-on-pawn attacks, pinned attackers, and unchanged old threats do not trigger it. Uses the one-reaction-per-move policy; mistakes and verified exceptional moves take priority; follows `misc` and the usual hand-and-brain sound rules. The control room chooses your moves, opponent moves, or both; default is both. It only considers the piece that moved, excludes unchanged threats, checks net material after recaptures.
- 🦴 **discovery**: moving a blocker uncovers check or a material-winning threat by an unmoved bishop, rook, or queen. Legal capture/recapture analysis excludes routine equal trades and pawn-only attacks. Uses the first five seconds of [xQc’s fossil clip](https://www.youtube.com/watch?v=knxrshWgEDM). Takes priority over reload.
- **castle** and **capture**: dedicated configurable triggers, disabled until a sound is assigned in the control room.
- 😭 **lost_queen**: they take your queen: *NOOOOO*, and 👋 **queen_trade**: *bye, have a great time* / sayonara
- 🚪 **king_capture**: the king takes something: *I am the one who knocks*
- 🍴 **fork**: a knight attacks the king and the queen or a rook at once: *surprise*

### Clock:
- 🎵 **opponent_slow**: one waiting clip after **2 seconds in bullet** or **3 seconds in blitz**: Jeopardy, elevator music or snoring. Configure both delays under Game & clock.
- 👨‍🍳 **you_slow**: the same delay on your turn: *let him cook*. Both waiting clips stop as soon as a move arrives.
- 🤔 Longer games keep the previous timing: Komarov impatience followed by waiting music after 15% of the base time (minimum 55 seconds). Early waiting clips are never interrupted by later impatience lines.
- 🎷 **time_scramble**: both clocks under 10 seconds: Yakety Sax (only big moments interrupt it)
- 🤨 **sus**: a Lichess account flag at game start; ongoing suspicion is logged only (see below)

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

## Sound control room

Run `npm run config` on the Mac and open **http://127.0.0.1:8769/**. The Mac uses the existing `ssh pi` connection to call `control-cli.mjs` inside the running container. The local bridge exposes no Pi HTTP port or Discord credentials. Keep this process running when using the Mac URL. The Pi also serves the same UI directly on its Tailscale interface at **http://pi.tail17bb6e.ts.net:8769/**; that URL works without the Mac.

Choose a Discord server, toggle triggers, choose which player can trigger a special move, preview any shipped clip at a comfortable volume, and build random sound pools. Upload MP3/WAV/Ogg (maximum 10 MB; first 30 seconds) to convert locally to Discord-ready Opus and store it durably on the Pi. Empty/default-off capture and castle triggers can be activated after choosing clips. Preview volume affects the website only.

**Save to Blunderbot** updates the live per-server settings; no bot restart is needed. The website rejects stale saves if another editor or Discord changed the same server's settings. Unsaved edits are automatically backed up in the browser and on every save attempt. A stale save retains the draft and offers Apply my edits; Back up edits also downloads a copy. Retired sound pools remain available in the pool picker. Uploads add library assets; they become active only after saving the event pool.

`data/timing.json` stores per-server waiting delays, `data/sound-rules.json` stores enabled/player/pool overrides, `data/custom-sounds.json` indexes uploads, and `data/custom/` keeps their audio. All are on the existing persistent volume and survive deployments. The bot watches settings changes so hand-and-brain and mute changes take effect during a game. The Mac bridge accepts only loopback requests; the Pi publishes its container port only on loopback and its Tailscale IP and accepts the configured tailnet origins. Both check Host/Origin, validates every sound ID, and never takes a remote shell command from the browser.

## Commands

- `/config` — Show saved sound settings for this server. Pass any combination of `dimitri`, `good_moves`, `bad_moves`, and `misc` as `true` or `false` to change them immediately. All four default to on. For example, `/config dimitri:false good_moves:false` leaves blunders and other moments enabled. `misc` covers captures, game results, clock sounds, and suspicion alerts; `bad_moves` covers the blunder tiers, misinput, and thrown wins. Settings survive restarts in `data/settings.json`, alongside the saved session.
- `/lichess <username>` - Start stalking a Lichess player (with their consent, hopefully)
- `/stop` - Stop the madness (coward)
- `/ping` - Check if the bot is alive and ready to judge you

Blunderbot leaves voice after five minutes without an active Lichess game, matching Paddibot. Set `IDLE_TIMEOUT_MINUTES` to change this. Active games, including long thinks, keep it connected. Leaving due to inactivity stops spectating and clears the saved session; use `/lichess` to start again. Unexpected voice disconnections are retried automatically while spectating.

Move-quality effects judge only your moves. Special-move effects independently choose your moves, the opponent’s, or both (default). Game and clock events do not depend on who moved last. Hand-and-brain piece cues still announce your turn. A new move stops the previous clip, and delayed analysis cannot play a reaction for an older move.

## Hand and brain

Enable `/config hand_and_brain:true`, then use `/lichess <username>` as usual. If the bot is already watching you, enabling the mode takes effect on the current turn. It announces **pawn, knight, bishop, rook, queen, or king** when it is your turn, and repeats that piece every three seconds until you move. Reminders stop when the position changes, the game ends, or the mode is disabled. You choose a move with that type of piece. Castling counts as a king move, and promotion counts as a pawn move. Moving a different piece gets a spoken “That was the wrong piece”; the bot cannot prevent a move in Lichess.

The piece comes from Stockfish's best move at `HAND_AND_BRAIN_DEPTH` (default 12, never below `STOCKFISH_DEPTH`), checked against the exact legal position. This means there is an engine-preferred move with the named piece; it does not promise that every move with that piece is good, or that a lost position can be saved. The bot never announces the destination or which of two same-type pieces to use. Standard chess and standard-chess starting positions are supported; other variants and out-of-sync positions produce no piece cue. Use this for training where engine assistance is permitted.

This mode replaces normal commentary, good-move sounds, and miscellaneous effects with short prerecorded piece cues. You can also hear blunder, misinput, and thrown-win sounds with `/config bad_moves:true`, or mute them with `/config bad_moves:false`. Piece cues take priority over these effects. `/config hand_and_brain:false` restores your full normal sound preferences. The setting is saved per server and survives deployments. Current games, including White's first move, are supported; delayed analysis from an earlier turn is discarded.

## How It Works (The Magic Behind the Misery)

1. **Stalking Phase**: Bot polls Lichess API every 3 seconds to see if you're playing
2. **Connection Phase**: Opens WebSocket to your game like a chess paparazzi
3. **Analysis Phase**: Feeds your moves to Stockfish for professional judgment
4. **Shame Phase**: Calculates move quality and plays appropriate sound effect
5. **Repeat**: Until you rage quit or achieve chess enlightenment

## Dmitri Komarov Commentary

Every move that doesn't get a meme sound (yours and your opponent's) gets GM Dmitri Komarov announcing it instead: *"Knight c3!"*, captures by their square, castling, checks, plus his draw lines. Resignations use the confirmed win/loss reaction. Only his move- and square-specific lines are used, never the random filler, and he never talks over another sound. The ~1400 clips come from Vincent Simard's [dmitlichess](https://github.com/vincentsimard/dmitlichess) extension (WTFPL), levelled a bit quieter than the memes, in `commentary/komarov/`. When the bot joins a game that's already running, the moves Lichess replays on connect stay silent.

## Cheater Detection (Is Your Opponent Suspiciously Good?)

The bot also judges your opponent. Every opponent move after the opening is scored by Stockfish (skipping positions that are already decided), and logs suspicion when they look engine-assisted:

- **Too accurate for their rating**: average centipawn loss compared to what's normal at their rating *and* time control (bullet players blunder more than rapid players at the same rating)
- **Engine top move** way too often
- **Robotic move times**: humans premove recaptures and burn clock on critical moves, engine copiers take the same few seconds for everything (ignored in bullet and time scrambles)
- **Throwaway account** (< 30 days old or < 50 games) nudges it further, and a Lichess ToS mark plays *sus* at game start

Suspicion escalations are currently logged only. The `sus` sound is connected to a Lichess account flag at game start; the `very_sus` and `opponent_blunder` pools have no live trigger. No chat spam: the numbers (ACPL, expected ACPL, engine match %, think-time CV, verdict) only go to the bot's log. The thresholds come from replaying real games of normal players and of Lichess-marked accounts (~5% of honest games trip it), so treat *sus* as vibes, not proof. `STOCKFISH_DEPTH` raises the search depth if your hardware can take it.

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

### Sound audit and quiet defaults

Normal best/excellent/good moves, fast-good rewards, routine king captures, queen-exchange jokes, three-check jokes, and scramble music do not play by default. The latter four remain optional in the control room. Castling and ordinary captures remain configurable but need assigned sounds. The 52 shipped clips were decoded and checked for duration and peak level; approved win/loss pools and their variety are retained.

The fossil line requires a newly uncovered check or a legal capture that wins at least a pawn's worth of material after recaptures. A discovered attack on a pawn alone or an equal queen trade does not qualify. Knights forking king and rook/queen use the fork event rather than the generic gun. Your move receives only one selected reaction, so an immediate board meme is not cut off by an engine meme. Game-result audio plays once after the confirmed result.
