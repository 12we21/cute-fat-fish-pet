#!/usr/bin/env node
// compare-upstream.mjs — compare this repository's `src\` against an upstream release tree.
//
// Why this exists: the README, NOTICE and docs claim "this file came from upstream, that one is ours".
// Claims like that should be reproducible by anyone, without trusting our word (or needing a 37 MB download).
//
// How it works: GitHub's git-trees API gives, for every file of a tag, the *git blob SHA-1* and the size.
// A git blob SHA-1 is `sha1("blob <size>\0" + content)`, so we can compute the same value for our local
// files and compare — no file contents have to be downloaded at all.
//
// Usage:
//   node build/compare-upstream.mjs                       # uses the defaults below
//   node build/compare-upstream.mjs --tree <tree.json> --prefix dsh-pet/ --local src
//   node build/compare-upstream.mjs --dir <extracted-npm-package> --label "npm 0.3.0"
//   node build/compare-upstream.mjs --json out.json --md out.md
//
// Getting a fresh tree JSON (one small request, no tarball):
//   gh api repos/PC2005-cloud/dsh-pet/git/trees/v0.3.0?recursive=1 > upstream-tree.json
//   # or: iwr "https://api.github.com/repos/PC2005-cloud/dsh-pet/git/trees/v0.3.0?recursive=1"

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const DEFAULTS = {
  tree: join(ROOT, "_upstream", "upstream-tree-v0.3.0.json"),
  prefix: "dsh-pet/", // where the npm package lives inside the upstream repository
  local: join(ROOT, "src"),
  label: "dsh-pet 0.3.0",
};

function parseArgs(argv) {
  const o = { ...DEFAULTS, json: null, md: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--tree") o.tree = next();
    else if (a === "--dir") o.dir = next();
    else if (a === "--prefix") o.prefix = next();
    else if (a === "--local") o.local = next();
    else if (a === "--label") o.label = next();
    else if (a === "--json") o.json = next();
    else if (a === "--md") o.md = next();
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--help" || a === "-h") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 18).join("\n"));
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

function blobSha1(buf) {
  const h = createHash("sha1");
  h.update(`blob ${buf.length}\0`, "utf8");
  h.update(buf);
  return h.digest("hex");
}

function walk(dir, base = dir, out = new Map()) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === ".git" || name === "__pycache__") continue;
      walk(p, base, out);
    } else if (st.isFile()) {
      out.set(relative(base, p).split(sep).join("/"), st.size);
    }
  }
  return out;
}

const opt = parseArgs(process.argv.slice(2));

// ---- upstream side -------------------------------------------------------
const upstream = new Map(); // rel path -> { size, sha }
let upstreamCommit = null;

if (opt.dir) {
  // Compare against an already-extracted copy (e.g. the published npm package, which is the
  // *built* form of the project and therefore the real ancestor of our `src\` tree).
  if (!existsSync(opt.dir)) {
    console.error(`upstream directory not found: ${opt.dir}`);
    process.exit(2);
  }
  for (const [rel] of walk(opt.dir)) {
    const buf = readFileSync(join(opt.dir, rel));
    upstream.set(rel, { size: buf.length, sha: blobSha1(buf) });
  }
} else {
  if (!existsSync(opt.tree)) {
    console.error(`upstream tree JSON not found: ${opt.tree}`);
    console.error("fetch it with: gh api \"repos/PC2005-cloud/dsh-pet/git/trees/v0.3.0?recursive=1\" > tree.json");
    process.exit(2);
  }
  // PowerShell's `Set-Content -Encoding UTF8` writes a BOM; strip it so the file can come from either shell.
  const treeText = readFileSync(opt.tree, "utf8").replace(/^\uFEFF/, "");
  const tree = JSON.parse(treeText);
  if (tree.truncated) {
    console.error("warning: the upstream tree response was truncated — the comparison below is incomplete");
  }
  upstreamCommit = tree.sha || null;
  for (const e of tree.tree || []) {
    if (e.type !== "blob") continue;
    if (!e.path.startsWith(opt.prefix)) continue;
    upstream.set(e.path.slice(opt.prefix.length), { size: e.size, sha: e.sha });
  }
}

// ---- our side -----------------------------------------------------------
const localSizes = walk(opt.local);
const local = new Map(); // rel path -> { size, sha }
for (const [rel] of localSizes) {
  const buf = readFileSync(join(opt.local, rel));
  local.set(rel, { size: buf.length, sha: blobSha1(buf) });
}

// ---- compare ------------------------------------------------------------
const same = [];
const differ = [];
const onlyUpstream = [];
const onlyOurs = [];

for (const [rel, up] of upstream) {
  const me = local.get(rel);
  if (!me) onlyUpstream.push({ rel, upSize: up.size });
  else if (me.sha === up.sha) same.push({ rel, size: me.size });
  else differ.push({ rel, upSize: up.size, ourSize: me.size, upSha: up.sha, ourSha: me.sha });
}
for (const [rel, me] of local) {
  if (!upstream.has(rel)) onlyOurs.push({ rel, ourSize: me.size });
}

const bySize = (a, b) => a.rel.localeCompare(b.rel);
same.sort(bySize);
differ.sort(bySize);
onlyUpstream.sort(bySize);
onlyOurs.sort(bySize);

const sum = (a, k) => a.reduce((n, x) => n + (x[k] || 0), 0);
const dirOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "(root)");
function group(list, key) {
  const m = new Map();
  for (const x of list) {
    const d = dirOf(x.rel);
    const g = m.get(d) || { dir: d, files: 0, bytes: 0 };
    g.files++;
    g.bytes += x[key] || 0;
    m.set(d, g);
  }
  return [...m.values()].sort((a, b) => b.files - a.files || a.dir.localeCompare(b.dir));
}

const report = {
  generatedAt: new Date().toISOString(),
  upstream: {
    label: opt.label,
    tree: opt.dir || opt.tree,
    prefix: opt.dir ? null : opt.prefix,
    commit: upstreamCommit,
  },
  local: opt.local,
  totals: {
    upstreamFiles: upstream.size,
    ourFiles: local.size,
    identical: same.length,
    differing: differ.length,
    onlyUpstream: onlyUpstream.length,
    onlyOurs: onlyOurs.length,
    identicalBytes: sum(same, "size"),
    differingUpstreamBytes: sum(differ, "upSize"),
    differingOurBytes: sum(differ, "ourSize"),
  },
  differ,
  onlyUpstream,
  onlyOursByDir: group(onlyOurs, "ourSize"),
  identicalByDir: group(same, "size"),
};

// ---- print --------------------------------------------------------------
if (!opt.quiet) {
  const t = report.totals;
  console.log(`upstream : ${opt.label} (prefix "${opt.prefix}") — ${t.upstreamFiles} files`);
  console.log(`ours     : ${opt.local} — ${t.ourFiles} files`);
  console.log(`identical: ${t.identical}`);
  console.log(`differing: ${t.differing}`);
  for (const d of differ) {
    console.log(`  ~ ${d.rel}  upstream ${d.upSize} B / ours ${d.ourSize} B`);
  }
  console.log(`only upstream: ${t.onlyUpstream}`);
  for (const d of onlyUpstream) console.log(`  - ${d.rel} (${d.upSize} B)`);
  console.log(`only ours    : ${t.onlyOurs} files, ${sum(onlyOurs, "ourSize")} B`);
  for (const g of report.onlyOursByDir) console.log(`  + ${g.dir}/ — ${g.files} files, ${g.bytes} B`);
}

// ---- write --------------------------------------------------------------
if (opt.json) {
  writeFileSync(opt.json, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nJSON written: ${opt.json}`);
}

if (opt.md) {
  const lines = [];
  const t = report.totals;
  lines.push(`### Comparison against ${opt.label}`, "");
  lines.push(`- upstream files (${opt.prefix}): **${t.upstreamFiles}**`);
  lines.push(`- files in our \`src\\\`: **${t.ourFiles}**`);
  lines.push(`- byte-identical (same git blob SHA-1): **${t.identical}**`);
  lines.push(`- different: **${t.differing}**`);
  lines.push(`- only upstream: **${t.onlyUpstream}**`);
  lines.push(`- only ours: **${t.onlyOurs}** (${sum(onlyOurs, "ourSize")} bytes)`, "");
  if (differ.length) {
    lines.push("| File (relative to the package root) | Upstream bytes | Our bytes |", "| --- | --- | --- |");
    for (const d of differ) lines.push(`| \`${d.rel}\` | ${d.upSize} | ${d.ourSize} |`);
    lines.push("");
  }
  if (onlyUpstream.length) {
    lines.push("Files that exist upstream but not in our `src\\`:", "");
    for (const d of onlyUpstream) lines.push(`- \`${d.rel}\` (${d.upSize} bytes)`);
    lines.push("");
  }
  if (report.onlyOursByDir.length) {
    lines.push("Directories that exist only in our `src\\` (not part of the upstream package):", "");
    lines.push("| Directory | Files | Bytes |", "| --- | --- | --- |");
    for (const g of report.onlyOursByDir) lines.push(`| \`${g.dir}/\` | ${g.files} | ${g.bytes} |`);
    lines.push("");
  }
  writeFileSync(opt.md, lines.join("\n"), "utf8");
  console.log(`Markdown written: ${opt.md}`);
}
