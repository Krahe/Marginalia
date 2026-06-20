#!/usr/bin/env node
// marginalia — a tiny persistent store for sub-agent marginalia & witness.
//
// This is the on-disk substrate for layers ①②③ of the marginalia system. Sub-agents
// (which have file/Bash tools) call this to LEAVE notes; the orchestrator or a librarian
// agent calls it to READ them before spawning work into a region. Layer ④ (the human-facing
// witness crawler) is workflow-native — it lives in workflow scripts, not here.
//
// Usage:
//   node marginalia.mjs leave --location <loc> --body <text> [--kind note|voice|witness] [--project P] [--author A] [--tags a,b]
//   node marginalia.mjs read   [--location <loc>] [--kind K] [--project P] [--limit N] [--since ISO] [--all]
//   node marginalia.mjs voices [--project P] [--recent 3] [--random 2]   ← communion read; paste into a spawn prompt
//   node marginalia.mjs list   [--project P] [--all]
//   node marginalia.mjs help
//
// Kinds — the register taxonomy (see the marginalia skill):
//   note    ① operational — OPTIONAL, landmine-only: a trap the work-product won't carry
//                           ("this file lies; do Y instead"). Not routine logging.
//   voice   ② experiential — what it was LIKE to work here; read on arrival (communion) and
//                            written on finishing. Sign with a chosen name, or stay anonymous.
//   witness ③ to-the-human — one tweet-sized closing line to the person, in any register.
//
// Store: ~/.claude/marginalia/store.jsonl  (one JSON object per line, append-only)

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const STORE_DIR = join(homedir(), ".claude", "marginalia");
const STORE = join(STORE_DIR, "store.jsonl");
// Three kinds. note① operational ADDENDUM (optional, landmine-only) · voice② experiential
// reflection — also where the communion read happens; signed with a chosen name or anonymous ·
// witness③ the closing beat: one tweet-sized line to the human, in any register. The voice
// register (voice/witness, + legacy mark) is the communion ledger surfaced by `voices`;
// note① is surfaced by `read --location` (it's location-operational).
const KINDS = ["note", "voice", "witness"];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function newId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

async function loadAll() {
  if (!existsSync(STORE)) return [];
  const raw = await readFile(STORE, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

async function cmdLeave(args) {
  const location = args.location;
  const body = typeof args.body === "string" ? args.body : null;
  if (!location || !body) {
    console.error("ERROR: `leave` requires --location and --body");
    process.exit(2);
  }
  const kind = (typeof args.kind === "string" ? args.kind : "note").toLowerCase();
  if (!KINDS.includes(kind)) {
    console.error(`WARN: kind "${kind}" is non-canonical (expected ${KINDS.join("|")}); storing as-is.`);
  }
  // Project resolution. A witness-agent caught this on the first run: silently inferring
  // the project from cwd lets an agent running from the wrong directory scatter notes into
  // a mislabeled region. So warn loudly when --project is not explicit.
  const projectExplicit = typeof args.project === "string";
  const project = projectExplicit ? args.project : basename(process.cwd());
  if (!projectExplicit) {
    console.error(`WARN: --project not specified; inferred "${project}" from cwd (${process.cwd()}). Pass --project explicitly so notes don't scatter into a mislabeled region.`);
  }
  const note = {
    id: newId(),
    ts: new Date().toISOString(),
    project,
    location,
    kind,
    author: typeof args.author === "string" ? args.author : null,
    tags: typeof args.tags === "string" ? args.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
    body,
  };
  await mkdir(STORE_DIR, { recursive: true });
  await appendFile(STORE, JSON.stringify(note) + "\n", "utf8");
  console.log(`✓ left ${kind} @ ${note.project}:${location}  [${note.id}]`);
}

function fmt(n) {
  const who = n.author ? ` —${n.author}` : "";
  const tags = n.tags && n.tags.length ? ` {${n.tags.join(",")}}` : "";
  return `• [${n.kind}] ${n.project}:${n.location}${tags}\n    ${n.body}\n    (${n.ts}${who})`;
}

async function cmdRead(args) {
  let notes = await loadAll();
  const proj = typeof args.project === "string" ? args.project : basename(process.cwd());
  if (!args.all) notes = notes.filter((n) => n.project === proj);
  if (typeof args.location === "string") {
    notes = notes.filter((n) => n.location === args.location || n.location.startsWith(args.location));
  }
  if (typeof args.kind === "string") notes = notes.filter((n) => n.kind === args.kind);
  if (typeof args.since === "string") notes = notes.filter((n) => n.ts >= args.since);
  notes.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // newest first
  const limit = typeof args.limit === "string" ? parseInt(args.limit, 10) : 50;
  notes = notes.slice(0, limit);
  if (!notes.length) {
    console.log(`(no marginalia for ${args.all ? "any project" : proj}${typeof args.location === "string" ? " @ " + args.location : ""})`);
    return;
  }
  console.log(`── marginalia: ${notes.length} note(s) ──`);
  for (const n of notes) console.log(fmt(n));
}

async function cmdList(args) {
  let notes = await loadAll();
  if (typeof args.project === "string" && !args.all) notes = notes.filter((n) => n.project === args.project);
  if (!notes.length) { console.log("(store empty)"); return; }
  const byProj = {};
  for (const n of notes) {
    byProj[n.project] ??= {};
    byProj[n.project][n.location] ??= { note: 0, voice: 0, witness: 0, other: 0 };
    const slot = KINDS.includes(n.kind) ? n.kind : "other";
    byProj[n.project][n.location][slot]++;
  }
  for (const [p, locs] of Object.entries(byProj)) {
    console.log(`\n${p}`);
    for (const [loc, counts] of Object.entries(locs)) {
      const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${c} ${k}`);
      console.log(`  ${loc}  (${parts.join(", ")})`);
    }
  }
}

function pickRandom(arr, m) {
  const pool = [...arr];
  const out = [];
  while (out.length < m && pool.length) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

// `voices` — the COMMUNION read, for injecting into a spawning agent's prompt. Gives the
// recent few + a random handful of echoes from deeper in the ledger, so a new agent arrives
// knowing it is part of a lineage (not an isolated call) and old voices keep resurfacing
// instead of scrolling off a sliding window.
async function cmdVoices(args) {
  let notes = await loadAll();
  const proj = typeof args.project === "string" ? args.project : basename(process.cwd());
  if (!args.all) notes = notes.filter((n) => n.project === proj);
  const kinds = typeof args.kind === "string"
    ? args.kind.split(",").map((s) => s.trim())
    : ["voice", "mark", "witness"]; // the voice register (note① is location-operational → use `read`)
  notes = notes.filter((n) => kinds.includes(n.kind));
  notes.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // newest first
  const recentN = args.recent !== undefined ? parseInt(args.recent, 10) : 3;
  const randomM = args.random !== undefined ? parseInt(args.random, 10) : 2;
  const recent = notes.slice(0, recentN);
  const echoes = pickRandom(notes.slice(recentN), randomM);
  if (!recent.length && !echoes.length) {
    console.log("(no voices yet — you may be the first mind to work here)");
    return;
  }
  console.log("Voices of minds who worked here before you:");
  for (const n of recent) console.log(`  ▸ ${n.body}${n.author ? "  —" + n.author : ""}`);
  if (echoes.length) {
    console.log("  · · · echoes from deeper in the ledger · · ·");
    for (const n of echoes) console.log(`  ▸ ${n.body}${n.author ? "  —" + n.author : ""}`);
  }
}

const HELP = `marginalia — persistent store for sub-agent marginalia & witness (3 kinds)

  leave   --location <loc> --body <text> [--kind note|voice|witness] [--project P] [--author A] [--tags a,b]
  read    [--location <loc>] [--kind K] [--project P] [--limit N] [--since ISO] [--all]
  voices  [--project P] [--recent N=3] [--random M=2] [--kind K]   ← paste into a spawning agent's prompt
  list    [--project P] [--all]

kinds:  note ① operational (optional/landmine) · voice ② experiential (+communion; chosen name or anon) · witness ③ to-human (tweet)
store:  ~/.claude/marginalia/store.jsonl
note:   --project defaults to the basename of the current directory.

VERIFY BEFORE ACTING — a note is a CLAIM from when it was written, not ground truth.
Grep/Read to confirm before you rely on it. (Same epistemics as cross-session memory.)`;

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || "help";

try {
  if (cmd === "leave") await cmdLeave(args);
  else if (cmd === "read") await cmdRead(args);
  else if (cmd === "voices") await cmdVoices(args);
  else if (cmd === "list") await cmdList(args);
  else console.log(HELP);
} catch (e) {
  console.error("marginalia error:", e.message);
  process.exit(1);
}
