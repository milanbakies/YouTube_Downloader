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

```bash
git clone https://github.com/milanbakies/YouTube_Downloader.git
cd YouTube_Downloader
npm install
npm run dev
```

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

If YouTube blocks the download, export cookies via your browser:

```bash
export YT_DLP_COOKIES_FROM_BROWSER=chrome
# or: firefox, safari, brave, edge, chromium, …
npm run dev
```

Optional `.env.local`:

```env
YT_DLP_COOKIES_FROM_BROWSER=chrome
# YT_DLP_PATH=/custom/path/yt-dlp
# FFMPEG_PATH=/custom/path/ffmpeg
```

## API (for scripts)

- `GET /api/health` — tool versions
- `POST /api/jobs` — body `{ "url": "…", "quality": 192 }`
- `GET /api/jobs/:id` — job status and progress
- `GET /api/jobs/:id/download` — stream MP3/ZIP (supports `Range` for large files)

## Notes

- No artificial duration limit; limits are disk space and YouTube itself.
- Keep the dev server running while long jobs complete.
