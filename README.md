# YouTube Downloader (MP3)

Local web app to convert YouTube **videos** and **playlists** to MP3. Built for long sessions (multi-hour videos) and full playlists. Uses **Next.js**, **yt-dlp**, and **ffmpeg**.

## Requirements

- Node.js 20+ (npm)
- [ffmpeg](https://ffmpeg.org/)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

On macOS with Homebrew:

```bash
brew install ffmpeg yt-dlp
```

Or run the helper script:

```bash
./scripts/setup.sh
```

## Run locally

**Easiest on macOS:** double-click `YouTube Downloader starten.command` in Finder. It stops any old server on port 4317, enables **Chrome YouTube cookies** (for bot checks), starts the app, and opens your browser. Stay signed in to [youtube.com](https://www.youtube.com) in Chrome; allow **Keychain** access the first time if macOS asks.

```bash
git clone https://github.com/milanbakies/YouTube_Downloader.git
cd YouTube_Downloader
npm install
npm run dev
```

If you see **`EADDRINUSE` on port 4317**, the app is usually already running — open [http://127.0.0.1:4317](http://127.0.0.1:4317). `npm run dev` now detects that and opens the browser instead of failing. To force a new server: stop the old terminal process, or run `npm run dev:force` after freeing the port (`lsof -nP -iTCP:4317 -sTCP:LISTEN`).

Open [http://127.0.0.1:4317](http://127.0.0.1:4317) or [http://localhost:4317](http://localhost:4317).

Production:

```bash
npm run build
npm run start -- -p 4317
```

## Usage

1. Paste a YouTube video or playlist URL.
2. Choose MP3 bitrate: 128, 192, 256, or 320 kbps.
3. Click **Start conversion**. Progress updates while yt-dlp runs in the background.
4. When finished, download a single **MP3** or a **ZIP** (playlists with multiple tracks).

Downloads are stored under `.data/jobs/` until you remove them.

## YouTube sign-in / bot checks

After several downloads YouTube often returns *Sign in to confirm you’re not a bot*. The app must pass **logged-in** cookies to yt-dlp.

Downloads run **without** cookies first. Signed-in cookies can make YouTube return a tiny broken file instead of the real audio.

**If YouTube asks you to sign in:** `YouTube Downloader starten.command` exports Chrome cookies once to `.data/cookies.txt` (Keychain at most once per ~12h). The app uses that file only after a bot check. Stay signed in to YouTube in Chrome.

To refresh cookies manually: `npm run cookies:export` (allow Keychain once).

**Alternative:** place a Netscape `cookies.txt` in the project folder (see [yt-dlp cookie export](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies)). That avoids Keychain prompts.

Manual start:

```bash
cd YouTube_Downloader
export YT_DLP_COOKIES_FROM_BROWSER=chrome
npm run dev:force
```

Optional `.env.local` (copy from `.env.example`):

```env
YT_DLP_COOKIES_FROM_BROWSER=chrome
# YT_DLP_COOKIES_FILE=cookies.txt
```

## API (for scripts)

- `GET /api/health` — tool versions
- `POST /api/jobs` — body `{ "url": "…", "quality": 192 }`
- `GET /api/jobs/:id` — job status and progress
- `GET /api/jobs/:id/download` — stream MP3/ZIP (supports `Range` for large files)

## Notes

- No artificial duration limit; limits are disk space and YouTube itself.
- Keep the dev server running while long jobs complete.
