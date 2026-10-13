// The browser part: open a page as a slow phone and as a desktop, scroll it to
// the bottom like a person would, then measure what is actually on screen.

import { findProblems } from "./report.js";

export const DEVICES = {
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
};

/* The bug this tool was born from: a layout shift after load pushed the scroll
   triggers below the end of the page, so the footer stayed invisible on phones.
   No error, no failing test. With `sabotage` on, its symptom is put back on
   purpose: the footer's contents are made transparent, which is what a visitor
   saw. (The cause itself, a trigger below the page, is reproduced in
   test/site/footer-never-appears.html.) A watch that cannot catch it is broken. */
const SABOTAGE_CSS = "footer * { opacity: 0 !important; }";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function inspect(browser, url, device, { sabotage = false, settleMs = 3000 } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  try {
    await page.setViewport(DEVICES[device]);
    if (device === "phone") {
      const cdp = await page.createCDPSession();
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 170, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    page.on("pageerror", (e) => errors.push(`page error: ${e.message.slice(0, 160)}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`); });
    page.on("requestfailed", (r) => errors.push(`request failed: ${r.url().slice(0, 100)} (${r.failure()?.errorText})`));
    page.on("response", (r) => { if (r.status() >= 500) errors.push(`server error ${r.status()}: ${r.url().slice(0, 100)}`); });
    if (sabotage) {
      await page.evaluateOnNewDocument((css) => addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style"); s.textContent = css; document.head.append(s);
      }), SABOTAGE_CSS);
    }

    const t0 = Date.now();
    const res = await page.goto(url, { waitUntil: "load", timeout: 60000 });
    const loadMs = Date.now() - t0;
    await sleep(settleMs);
    const firstPaintMs = await page.evaluate(() => Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0));

    /* Scroll like a person: sections that appear on scroll are only triggered this way. */
    let last = -1;
    for (let i = 0; i < 150; i++) {
      await page.mouse.wheel({ deltaY: 500 });
      await sleep(120);
      const y = await page.evaluate(() => Math.round(scrollY));
      if (y === last) break;
      last = y;
    }
    await sleep(settleMs / 2);

    /* Compare against the device width, not innerWidth: a mobile browser zooms out to fit
       wide content, so innerWidth grows with the bug and the overflow would hide itself. */
    /* What counts as "never appeared": text that takes up space but is still
       transparent or hidden after a full scroll, checked up to <html> (a page
       that fades in its <body> and never finishes is entirely invisible).
       Elements that take no space (display:none) are left alone on purpose:
       menus and tabs hide that way all the time. A footer is the exception:
       one with text that collapses to zero height is reported. Headings are
       checked in <main>, or in the whole body when the page has no <main>,
       outside navigation, dialogs and anything marked hidden. */
    const seen = await page.evaluate((deviceWidth) => {
      const hidden = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (s.opacity === "0" || s.visibility === "hidden") return true;
        }
        return false;
      };
      const hasText = (e) => e.textContent.trim() && e.getBoundingClientRect().height > 0;
      const footer = [...document.querySelectorAll("footer")].pop();
      const scope = document.querySelector("main") ?? document.body;
      const ignored = (e) => e.closest('nav, header, dialog, [aria-hidden="true"], [hidden]');
      return {
        invisibleFooterParts: footer ? [...footer.querySelectorAll("a, p, span, h2, h3, li")].filter((e) => hasText(e) && hidden(e)).length : 0,
        collapsedFooter: !!footer && !!footer.textContent.trim() && footer.getBoundingClientRect().height === 0,
        hiddenHeadings: [...scope.querySelectorAll("h1, h2, h3")].filter((e) => !ignored(e) && hasText(e) && hidden(e)).map((e) => e.textContent.trim().slice(0, 40)),
        overflowPx: document.documentElement.scrollWidth - deviceWidth,
        brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0).map((i) => i.src.slice(-60)),
      };
    }, DEVICES[device].width);
    const m = { status: res?.status(), loadMs, firstPaintMs, errors, ...seen };
    return { device, firstPaintMs, problems: findProblems(m) };
  } catch (e) {
    return { device, firstPaintMs: 0, problems: [`could not inspect: ${e.message.slice(0, 120)}`] };
  } finally {
    await ctx.close().catch(() => {});
  }
}
