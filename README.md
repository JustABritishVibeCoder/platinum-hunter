# Platinum Hunter

A little Windows app I use to hunt Platinums. Started it for the GTA V PS5 plat and it kind of grew from there.

You pick the game you're playing, it times your session, and it tells you which trophy to go for next and why. You can tick trophies off yourself or (optionally) sync them from PSN.

## Download

Grab the installer from the [Releases](../../releases) page and run it. It installs just for your user, no admin needed.

Windows SmartScreen might moan because the installer isn't signed. Click **More info → Run anyway**.

## What's in it

- **Home screen** – PS5-style launcher. Your recent games as tiles, hit one and go.
- **Next trophy** – picks the easiest, quickest, or best-progress trophy you can actually do right now. It checks story progress, missables, whether something needs online or other players, and explains the pick instead of just giving you a score. If it doesn't know something (like how far into the story you are), it just asks.
- **"I just earned…"** – press Ctrl+E, type a few letters, hit Enter. Done.
- **Trophy list** – everything grouped into categories (quick wins, missables, story, collectibles, online, co-op, grinds…) or as a plain list with filters.
- **Roadmap** – the plat broken into phases with what's done, what's available, and what's blocked (and why).
- **Sessions** – the timer keeps going even if you close the app. History shows what you earned each session.
- **GTA V (PS5)** – the full 78-trophy PS5 list is built in, with missable warnings, prerequisites and rough time/difficulty estimates. The PS4 list is kept completely separate so the two never get mixed up. Details in [docs/GTA_V_PS5_DATASET.md](docs/GTA_V_PS5_DATASET.md).
- **Discord** – optional Rich Presence ("Hunting the GTA V Platinum · 34/50").
- Stats, backups, export/import, a few themes.

Estimates (difficulty/time) are my own rough numbers based on guides like PowerPyx. They're labelled as estimates in the app, not official data.

## PSN sync (read this first)

PSN sync is **off by default**.

Sony doesn't have a public trophy API, so this uses the same unofficial sign-in the PlayStation app uses (you paste an NPSSO token from Sony's site). My account got locked the morning after I first used it. Might've been a coincidence, might not. So if you turn it on:

- it syncs **at most once an hour** and never in the background
- there's a hard cap of 20 requests an hour
- your token is stored in Windows Credential Manager, not in a file
- turning it off deletes the token straight away

Use it at your own risk. Without it everything still works, you just mark trophies yourself. More detail in [docs/PSN_INTEGRATION.md](docs/PSN_INTEGRATION.md).

## Discord setup

1. Make an app at the [Discord Developer Portal](https://discord.com/developers/applications) called "Platinum Hunter".
2. Copy its Application ID.
3. Paste it in **Settings → Discord Rich Presence** and switch it on.

Discord needs to be open on the same PC.

## Building it yourself

You'll need Node 22+, Rust (stable), and Visual Studio Build Tools with the C++ workload.

```bash
npm install
npm run app:dev      # run with hot reload
npm run check        # types, lint, tests
npm run test:rust    # rust tests
npm run app:build    # builds the installer
```

The installer ends up in `src-tauri/target/release/bundle/nsis/`.

`npm run dev` opens the UI in a normal browser for quick design work. It uses a throwaway in-memory database and can't talk to PSN.

## Where stuff is saved

- Database: `%APPDATA%\com.platinumhunter.desktop\platinum-hunter.db`
- Backups: `%APPDATA%\com.platinumhunter.desktop\backups\`
- Cached images: `%LOCALAPPDATA%\com.platinumhunter.desktop\images\`
- PSN token (if you use sync): Windows Credential Manager

Nothing gets uploaded anywhere. Exports never include the PSN token.

## Tech

Tauri 2 (Rust) + React + TypeScript + Vite + Tailwind, SQLite for storage. The Rust side handles the database and all the PSN networking, so the token never touches the UI.

```
src-tauri/src/   rust backend (db, psn client, discord, image cache)
src/catalog/     trophy datasets (gta-v-ps5.json)
src/domain/      recommendation engine, roadmap, status logic
src/db/          migrations + queries
src/features/    the screens
```

## Known issues / limits

- PSN sync is unofficial and could break (or get your account flagged) at any time.
- Session time is time since you hit Start, not actual console playtime.
- The app can't see what's running on your PS5, so you pick the game yourself.
- GTA V story mission order is approximate.
- Only tested on Windows 11.

Not affiliated with Sony or Rockstar. PlayStation is a trademark of Sony Interactive Entertainment.
