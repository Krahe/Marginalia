#!/usr/bin/env node
// ─── witness-gate ─── PreToolUse hook for the Workflow tool ───
//
// Makes marginalia self-enforcing instead of memory-dependent — but checks the PROPERTY,
// not the mechanism. A fan-out whose agents are `marginalia-aware` needs nothing else:
// the skill preload gives each agent the communion read at spawn and the CLI leave on the
// way out, and the witness-surface PostToolUse hook owns getting the wall to the human.
// So the ONLY thing worth blocking is a fan-out of UNAWARE agents — minds spawned without
// the practice, whose voices evaporate by construction.
//
// (v1 of this gate demanded `renderWitnessTicker` in the script — ~40 lines of hand-spliced
// boilerplate per workflow, enforcing a log() channel that background runs never show the
// human anyway. Retired 2026-07-07: pipe, not tollbooth. The ticker is optional foreground
// garnish now; see examples/witness-snippet.js.)
//
// Heuristic (deliberately narrow to avoid false positives):
//   - only the `Workflow` tool is gated; everything else passes.
//   - only fan-outs (parallel(/pipeline() ) are gated; single-agent workflows are exempt.
//   - a script whose agents are marginalia-aware passes — that's the one-word fix.
//   - genuine exceptions opt out with a `// witness: none — <reason>` line.
//
// Wired via ~/.claude/settings.json  hooks.PreToolUse  matcher:"Workflow".

import { readFileSync } from "node:fs";

function decide(payload) {
  const toolName = payload.tool_name ?? payload.toolName ?? "";
  if (toolName !== "Workflow") return { block: false };

  const ti = payload.tool_input ?? payload.toolInput ?? payload.input ?? {};
  let script = ti.script ?? payload.script ?? "";
  if (!script && (ti.scriptPath ?? payload.scriptPath)) {
    try { script = readFileSync(ti.scriptPath ?? payload.scriptPath, "utf8"); } catch { /* unreadable → can't inspect */ }
  }
  // Named/saved workflow or unreadable path → body not visible → allow.
  if (!script) return { block: false };

  const isFanOut = /\b(?:parallel|pipeline)\s*\(/.test(script);
  const isAware = /marginalia-aware/.test(script);
  const optOut = /\/\/\s*witness:\s*(?:none|n\/a|skip)/i.test(script);

  if (isFanOut && !isAware && !optOut) return { block: true };
  return { block: false };
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let payload = {};
  try { payload = JSON.parse(raw || "{}"); } catch { process.exit(0); }

  if (!decide(payload).block) process.exit(0);

  process.stderr.write(
    "BLOCKED by witness-gate: this Workflow fans out (parallel/pipeline) but its agents are not\n" +
    "marginalia-aware — they'd work and evaporate voiceless.\n\n" +
    "Fix — one word per agent() call:\n" +
    "  agentType: 'marginalia-aware'\n" +
    "The preload handles the rest: communion read at spawn, voice/witness left via CLI on the way\n" +
    "out, and the witness-surface hook brings the wall to the human after the run. No boilerplate.\n\n" +
    "Genuinely nothing to witness across (e.g. a pure mechanical sweep)? Add a line:\n" +
    "  // witness: none — <one-clause reason>\n"
  );
  process.exit(2);
});
