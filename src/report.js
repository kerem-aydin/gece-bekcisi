// Pure parts of the watch: thresholds, noise filtering, retries and the report.
// No browser here, so all of it is tested without a network.

/* Generous on purpose: CI machines run a throttled phone slower than a laptop.
   The goal is to catch "broken", not "a bit slow". */
export const THRESHOLDS = { firstPaintMs: 5000, loadMs: 15000, overflowPx: 2 };

/* Requests the browser logs as failed but that are not the site's problem. */
export const NOISE = [/favicon/i, /googletagmanager|google-analytics|doubleclick/i, /ERR_ABORTED/i, /_vercel\/(insights|speed-insights)/i];

/** Turns raw page measurements into human-readable problems. Empty array = clean. */
export function findProblems(m, t = THRESHOLDS) {
  const p = [];
  if (m.status !== 200) p.push(`page did not open (HTTP ${m.status ?? "none"})`);
  if (!m.firstPaintMs) p.push("nothing was painted");
  else if (m.firstPaintMs > t.firstPaintMs) p.push(`slow: first paint ${(m.firstPaintMs / 1000).toFixed(1)} s`);
  if (m.loadMs > t.loadMs) p.push(`load took ${(m.loadMs / 1000).toFixed(1)} s`);
  if (m.invisibleFooterParts > 0) p.push(`${m.invisibleFooterParts} footer item(s) never became visible`);
  if (m.collapsedFooter) p.push("footer has text but takes no space");
  if (m.hiddenHeadings?.length) p.push(`section never appeared after scrolling: ${m.hiddenHeadings.slice(0, 3).join(" · ")}`);
  if (m.overflowPx > t.overflowPx) p.push(`page scrolls sideways (${m.overflowPx} px)`);
  if (m.brokenImages?.length) p.push(`broken image: ${m.brokenImages.slice(0, 2).join(", ")}`);
  const errors = [...new Set((m.errors ?? []).filter((e) => !NOISE.some((n) => n.test(e))))];
  p.push(...errors.slice(0, 3));
  return p;
}

/** A one-off network hiccup should not wake anyone up: a failing check is run
    once more and only that second result is reported. */
export function mergeRetry(first, retry) {
  return first.map((r) => retry.find((x) => x.path === r.path && x.device === r.device) ?? r);
}

export function formatReport(results, site) {
  const bad = results.filter((r) => r.problems.length);
  if (!bad.length) return { ok: true, text: `Night watch: ${new Set(results.map((r) => r.path)).size} page(s) on ${site} are clean on phone and desktop.` };
  const lines = bad.map((r) => `- ${r.device} ${r.path}: ${r.problems.join("; ")}`);
  return { ok: false, text: `Night watch found ${bad.length} problem(s) on ${site}\n\n${lines.join("\n")}` };
}
