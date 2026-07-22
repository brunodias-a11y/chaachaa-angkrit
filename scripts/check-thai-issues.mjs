/**
 * Compares recently closed issues in ChaaChaaThai with a local tracking file.
 * Reports which ChaaChaaThai issues have not yet been ported to angkrit.
 *
 * Usage:  node scripts/check-thai-issues.mjs [--days 14]
 *         node scripts/check-thai-issues.mjs --mark 881 882 883   (mark as ported)
 *
 * Tracking file: scripts/ported-thai-issues.json
 * Reads tokens from .env in the project root.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir  = dirname(fileURLToPath(import.meta.url));
const TRACK  = resolve(__dir, "ported-thai-issues.json");

function loadEnv(filePath) {
  const vars = {};
  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {}
  return vars;
}

const env = { ...loadEnv(resolve(__dir, "../.env")), ...process.env };
const THAI_TOKEN    = env.GITHUB_THAI_TOKEN;
const THAI_OWNER    = env.GITHUB_REPO_THAI_OWNER || "brunodias-a11y";
const THAI_REPO     = env.GITHUB_REPO_THAI_NAME  || "chaachaathai";

// --mark mode: just record issue numbers as ported and exit
const markIdx = process.argv.indexOf("--mark");
if (markIdx !== -1) {
  const nums = process.argv.slice(markIdx + 1).filter(a => /^\d+$/.test(a)).map(Number);
  if (nums.length === 0) { console.error("--mark requires issue numbers, e.g. --mark 881 882"); process.exit(1); }
  const existing = existsSync(TRACK) ? JSON.parse(readFileSync(TRACK, "utf8")) : { ported: [] };
  existing.ported = [...new Set([...existing.ported, ...nums])].sort((a, b) => a - b);
  writeFileSync(TRACK, JSON.stringify(existing, null, 2));
  console.log(`Marked as ported: ${nums.map(n => "#" + n).join(", ")}`);
  process.exit(0);
}

const DAYS = (() => {
  const idx = process.argv.indexOf("--days");
  if (idx !== -1) return parseInt(process.argv[idx + 1] || "14");
  const inline = process.argv.find(a => a.startsWith("--days="));
  return inline ? parseInt(inline.split("=")[1]) : 14;
})();

async function ghFetch(token, path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`);
  return res.json();
}

async function fetchAllPages(token, path, params = "") {
  const items = [];
  let page = 1;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const data = await ghFetch(token, `${path}${sep}${params}&per_page=100&page=${page}`);
    if (!Array.isArray(data) || data.length === 0) break;
    items.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return items;
}

const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

console.log(`\nChecking ChaaChaaThai issues closed since ${cutoff.toLocaleDateString("pt-BR")} (last ${DAYS} days)...\n`);

// Fetch closed Thai issues — filter by closed_at post-fetch (API `since` uses updated_at)
const thaiClosed = await fetchAllPages(
  THAI_TOKEN,
  `/repos/${THAI_OWNER}/${THAI_REPO}/issues`,
  `state=closed&sort=updated&direction=desc`
);

const thaiIssues = thaiClosed
  .filter(i => !i.pull_request && i.closed_at && new Date(i.closed_at) >= cutoff)
  .sort((a, b) => b.number - a.number);

if (thaiIssues.length === 0) {
  console.log(`No issues closed in ChaaChaaThai in the last ${DAYS} days.`);
  process.exit(0);
}

// Load tracking file
const tracking = existsSync(TRACK) ? JSON.parse(readFileSync(TRACK, "utf8")) : { ported: [] };
const portedSet = new Set(tracking.ported);

const ported    = thaiIssues.filter(i => portedSet.has(i.number));
const notPorted = thaiIssues.filter(i => !portedSet.has(i.number));

console.log(`Issues closed in last ${DAYS} days:  ${thaiIssues.length}`);
console.log(`Already ported to angkrit:           ${ported.length}`);
console.log(`Pending / not yet ported:            ${notPorted.length}\n`);

if (notPorted.length === 0) {
  console.log("✅  All recent ChaaChaaThai issues are already ported to angkrit.");
} else {
  console.log("⚠️  Pending — not yet ported to angkrit:\n");
  for (const i of notPorted) {
    const closedAt = new Date(i.closed_at).toLocaleDateString("pt-BR");
    console.log(`  #${i.number} [${closedAt}]  ${i.title}`);
    console.log(`         ${i.html_url}\n`);
  }
  console.log(`To mark issues as ported after implementing them:`);
  console.log(`  node scripts/check-thai-issues.mjs --mark ${notPorted.slice(0, 3).map(i => i.number).join(" ")} ...\n`);
}

if (ported.length > 0) {
  console.log("✅  Already ported:\n");
  for (const i of ported) {
    const closedAt = new Date(i.closed_at).toLocaleDateString("pt-BR");
    console.log(`  #${i.number} [${closedAt}]  ${i.title}`);
  }
}
