import test from "node:test";
import assert from "node:assert/strict";
import { findProblems, mergeRetry, formatReport } from "../src/report.js";

const clean = { status: 200, loadMs: 900, firstPaintMs: 700, invisibleFooterParts: 0, hiddenHeadings: [], overflowPx: 0, brokenImages: [], errors: [] };

test("a clean measurement has no problems", () => {
  assert.deepEqual(findProblems(clean), []);
});

test("each silent failure becomes one readable problem", () => {
  const p = findProblems({ ...clean, invisibleFooterParts: 2, hiddenHeadings: ["Pricing"], overflowPx: 90, brokenImages: ["hero.png"] });
  assert.equal(p.length, 4);
  assert.match(p[0], /2 footer item/);
  assert.match(p[1], /Pricing/);
  assert.match(p[2], /90 px/);
  assert.match(p[3], /hero\.png/);
});

test("page that did not open, painted nothing, or was slow", () => {
  assert.match(findProblems({ ...clean, status: 503 })[0], /HTTP 503/);
  assert.match(findProblems({ ...clean, firstPaintMs: 0 })[0], /nothing was painted/);
  assert.match(findProblems({ ...clean, firstPaintMs: 6200 })[0], /6\.2 s/);
});

test("analytics and favicon noise is ignored, real errors are deduplicated and capped", () => {
  const errors = ["request failed: https://www.googletagmanager.com/gtm.js (net::ERR_FAILED)", "console: favicon 404",
    "page error: x is undefined", "page error: x is undefined", "server error 500: /api/a", "server error 502: /api/b", "server error 503: /api/c"];
  const p = findProblems({ ...clean, errors });
  assert.deepEqual(p, ["page error: x is undefined", "server error 500: /api/a", "server error 502: /api/b"]);
});

test("a retry replaces only the checks it re-ran", () => {
  const first = [{ path: "/", device: "phone", problems: ["timeout"] }, { path: "/", device: "desktop", problems: [] }];
  const merged = mergeRetry(first, [{ path: "/", device: "phone", problems: [] }]);
  assert.deepEqual(merged.map((r) => r.problems.length), [0, 0]);
});

test("report: one line when clean, one line per failing check otherwise", () => {
  const ok = formatReport([{ path: "/", device: "phone", problems: [] }, { path: "/", device: "desktop", problems: [] }], "example.com");
  assert.equal(ok.ok, true);
  assert.match(ok.text, /1 page\(s\) on example\.com are clean/);
  const bad = formatReport([{ path: "/", device: "phone", problems: ["page scrolls sideways (90 px)"] }], "example.com");
  assert.equal(bad.ok, false);
  assert.match(bad.text, /- phone \/: page scrolls sideways/);
});
