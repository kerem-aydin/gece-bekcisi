// End-to-end: a real browser against small pages that reproduce real bugs.
// Skipped when no Chrome is installed; CI installs it.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { inspect } from "../src/watch.js";

const chrome = process.env.CHROME_PATH ?? ["/usr/bin/google-chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
const site = new URL("./site/", import.meta.url);

test("real browser catches what a green test suite misses", { skip: !chrome && "no Chrome found" }, async (t) => {
  const { default: puppeteer } = await import("puppeteer-core");
  const server = createServer(async (req, res) => {
    try { const body = await readFile(new URL("." + req.url, site)); res.writeHead(200, { "content-type": "text/html" }).end(body); }
    catch { res.writeHead(404).end(); }
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const run = (page, device, opts) => inspect(browser, `${base}/${page}`, device, { settleMs: 600, ...opts });
  try {
    await t.test("clean page is clean on phone and desktop", async () => {
      assert.deepEqual((await run("clean.html", "phone")).problems, []);
      assert.deepEqual((await run("clean.html", "desktop")).problems, []);
    });
    await t.test("footer whose scroll trigger sits below the page never appears", async () => {
      assert.match((await run("footer-never-appears.html", "phone")).problems.join(), /footer item/);
    });
    await t.test("sideways scroll on a phone only", async () => {
      assert.match((await run("overflow.html", "phone")).problems.join(), /scrolls sideways/);
      assert.deepEqual((await run("overflow.html", "desktop")).problems, []);
    });
    await t.test("broken image", async () => {
      assert.match((await run("broken-image.html", "desktop")).problems.join(), /broken image/);
    });
    await t.test("self-test: the known bug, put back on purpose, is caught", async () => {
      assert.match((await run("clean.html", "phone", { sabotage: true })).problems.join(), /footer item/);
    });
  } finally {
    await browser.close();
    server.close();
  }
});
