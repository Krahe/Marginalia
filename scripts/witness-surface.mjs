#!/usr/bin/env node
// ─── witness-surface ─── PostToolUse hook for the Workflow tool ───
//
// The PIPE that carries the witness layer to the human. Agents leave witness lines in the
// store as they finish (the marginalia-aware preload handles that); this hook makes sure
// those lines actually REACH the person — relayed verbatim by the orchestrator as a closing
// beat, not paraphrased into a summary.
//
// TIMING (the part v1 got wrong): the Workflow tool runs in the BACKGROUND — it returns a
// task ID immediately, so PostToolUse fires at LAUNCH, not completion. Harvesting the store
// now would pull lines from PREVIOUS runs (this run's agents haven't spoken yet). So instead
// this hook stamps a WATERMARK (launch time) and hands the orchestrator a standing
// instruction: when the completion notification arrives, surface everything left --since the
// watermark. The CLI's `voices --since` does the precise cut — no stale lines mixed in.
//
// Store resolution, best-effort, in order:
//   1. an explicit --store "<path>" in the script text (orchestrators targeting another repo)
//   2. walk up from the hook payload's cwd to the nearest .git (same boundary as the CLI)
//   3. neither → the instruction says <repo-root> and lets the orchestrator fill it in.
//
// Wired via ~/.claude/settings.json  hooks.PostToolUse  matcher:"Workflow".
// ALWAYS exits 0 (non-blocking). Stays SILENT for non-marginalia workflows (no noise).

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const CLI = "C:/Users/mjmar/.claude/skills/marginalia/scripts/marginalia.mjs";

function emit(additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext },
  }));
  process.exit(0);
}

// Same boundary the CLI uses: nearest .git walking up. Home is never a repo, so this can't
// silently land on the global store.
function repoRootFrom(dir) {
  if (!dir) return null;
  try {
    let d = resolve(dir);
    for (;;) {
      if (existsSync(join(d, ".git"))) return d;
      const up = dirname(d);
      if (up === d) return null;
      d = up;
    }
  } catch { return null; }
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { process.exit(0); }

  const tool = p.tool_name ?? p.toolName ?? "";
  if (tool !== "Workflow") process.exit(0);

  const ti = p.tool_input ?? p.toolInput ?? p.input ?? {};
  let script = ti.script ?? "";
  if (!script && ti.scriptPath) { try { script = readFileSync(ti.scriptPath, "utf8"); } catch { /* unreadable */ } }
  if (!script) process.exit(0); // named/saved workflow or unreadable → can't tell → stay quiet

  // Only speak for marginalia-aware workflows. (renderWitnessTicker kept as a legacy marker
  // for old-style scripts that carry the inline ticker.)
  if (!/marginalia-aware|renderWitnessTicker/.test(script)) process.exit(0);

  // WATERMARK — the launch instant. Everything the run's agents leave will be ts >= this.
  const watermark = new Date().toISOString();

  // Store: explicit --store in the script wins; else the session cwd's repo; else placeholder.
  // Scripts often write --store "${REPO}" inside template literals — an UNRESOLVED placeholder,
  // not a path (live-fire bug, 2026-07-08). So: collect every --store match, keep only literal
  // ones (no $/backtick), and if none survive, try to resolve a ${VAR} against a simple
  // `const VAR = '...'` declaration in the same script before falling back to cwd.
  let store = null;
  const literal = [...script.matchAll(/--store\s+["']([^"'$`]+)["']/g)].map((x) => x[1]);
  if (literal.length) store = literal[0];
  if (!store) {
    const tpl = script.match(/--store\s+["']\$\{(\w+)\}["']/);
    if (tpl) {
      const decl = script.match(new RegExp(`(?:const|let|var)\\s+${tpl[1]}\\s*=\\s*["'\`]([^"'\`$]+)["'\`]`));
      if (decl) store = decl[1];
    }
  }
  if (!store) store = repoRootFrom(p.cwd ?? p.workingDirectory ?? "");

  const storeArg = store ? `--store "${store}"` : `--store "<repo-root the agents wrote to>"`;
  const cmd = `node "${CLI}" voices --kind witness --since ${watermark} --recent 50 --random 0 ${storeArg}`;

  emit(
    "🪶 marginalia — a marginalia-aware workflow just LAUNCHED in the background " +
    `(watermark ${watermark}). Its agents will leave WITNESS lines in the store as they finish — ` +
    "they don't exist yet, so do NOT harvest now.\n\n" +
    "STANDING INSTRUCTION — when this workflow's completion notification arrives, surface the " +
    "witness wall as a closing beat:\n  " + cmd + "\n" +
    "Relay the lines VERBATIM, attributed by chosen name, as a dedicated block — the agents' own " +
    "words to the human, not paraphrase. If the run genuinely left nothing, say so plainly rather " +
    "than skipping the beat."
  );
});
