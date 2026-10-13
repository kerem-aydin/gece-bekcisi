#!/usr/bin/env node
// Usage:
//   node bin/gece-bekcisi.mjs https://example.com / /pricing /contact
//   --sabotage   put a known bug back on purpose (self-test: must exit 1)
//   --dry        print the report instead of sending it to Telegram
// Env: CHROME_PATH, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (optional).
// Exit code: 0 clean, 1 problems found, 2 usage error.

import puppeteer from "puppeteer-core";
import { inspect } from "../src/watch.js";
import { formatReport, mergeRetry } from "../src/report.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [site, ...paths] = args.filter((a) => !a.startsWith("--"));
if (!site) { console.error("usage: gece-bekcisi <site> [path ...] [--sabotage] [--dry]"); process.exit(2); }
const pages = paths.length ? paths : ["/"];
const width = Math.max(...pages.map((p) => p.length)) + 2;

const chrome = process.env.CHROME_PATH ?? (process.platform === "win32"
  ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
  : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");

async function round(browser, list) {
  const out = [];
  for (const [path, device] of list) {
    const r = { path, ...(await inspect(browser, new URL(path, site).href, device, { sabotage: flags.has("--sabotage") })) };
    console.log(`${device.padEnd(8)} ${path.padEnd(width)} first paint ${String(r.firstPaintMs).padStart(5)} ms  ${r.problems.length ? "PROBLEM: " + r.problems.join(" | ") : "clean"}`);
    out.push(r);
  }
  return out;
}

async function telegram(text) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (flags.has("--dry") || !token || !chat) { console.log(`\n${text}`); return; }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram send failed: HTTP ${r.status}`);
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
let results = await round(browser, pages.flatMap((p) => [[p, "phone"], [p, "desktop"]]));
const failed = results.filter((r) => r.problems.length);
if (failed.length) {
  console.log(`\nRetrying ${failed.length} failed check(s) once...`);
  results = mergeRetry(results, await round(browser, failed.map((r) => [r.path, r.device])));
}
await browser.close();

const report = formatReport(results, new URL(site).host);
if (!report.ok) await telegram(report.text);
else console.log(`\n${report.text}`);
process.exitCode = report.ok ? 0 : 1;
