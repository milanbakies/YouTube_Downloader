#!/usr/bin/env bash
set -euo pipefail

if command -v brew >/dev/null 2>&1; then
  brew install ffmpeg yt-dlp
else
  echo "Homebrew not found. Install ffmpeg and yt-dlp manually."
  exit 1
fi

echo "ffmpeg: $(command -v ffmpeg)"
echo "yt-dlp: $(command -v yt-dlp)"
