import { chromium } from "playwright";

const url = "http://127.0.0.1:4317";
const testLink = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);

const input = page.locator("#url");
await input.fill(testLink);
await page.selectOption("#quality", "256");

const value = await input.inputValue();
const quality = await page.locator("#quality").inputValue();
if (quality !== "256") {
  throw new Error(`Quality select failed, value was: ${quality}`);
}
if (!value.includes("youtube.com")) {
  throw new Error(`Paste failed, value was: ${value}`);
}

const button = page.getByRole("button", { name: "Start conversion" });
if (await button.isDisabled()) {
  throw new Error("Start conversion stayed disabled after paste");
}

await button.click();
await page.waitForSelector("text=Status:", { timeout: 10000 });

console.log("OK: paste kept URL and conversion started");
await browser.close();
