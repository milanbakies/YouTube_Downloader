export function formatYtdlpFailure(
  stderrTail: string,
  code: number | null,
): string {
  const tail = stderrTail.trim();
  const errorLine =
    tail
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("ERROR:"))
      .pop() ?? tail.slice(-400);

  if (
    /Invalid data found when processing input|Error opening input files/i.test(
      tail,
    )
  ) {
    return [
      "ffmpeg could not convert the downloaded audio (often a bad partial file).",
      "The app retries up to three times; if this persists, start a new conversion or run: npm run cookies:export",
    ].join(" ");
  }

  if (/Sign in to confirm|not a bot/i.test(tail)) {
    return [
      "YouTube is asking for a logged-in browser (bot check).",
      'Start the app with "YouTube Downloader starten.command" so Chrome cookies are used, or run:',
      "export YT_DLP_COOKIES_FROM_BROWSER=chrome && npm run dev:force",
      "(Allow Keychain access if macOS asks. Stay signed in to youtube.com in Chrome.)",
    ].join(" ");
  }

  return `yt-dlp failed (exit ${code ?? "?"}). ${errorLine}`.slice(0, 900);
}
