import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { c, err, step, defaultWikiRoot } from "./util.js";

/**
 * Suggest link candidates for freshly-written pages. Delegates to the bundled
 * scripts/suggest-links.mjs (the source of truth): it queries the qmd index for
 * pages each target is most related to but does not yet link, and prints a triage
 * worklist. The agent types + accepts the real ones; the script never writes edges.
 * Connection-DISCOVERY for the ingest — the thing agent-memory linking misses.
 */
export function suggestLinks(opts: {
  wiki?: string; collection?: string; n?: string; minScore?: string; json?: boolean;
}, pages: string[]): void {
  const wiki = resolve(opts.wiki || defaultWikiRoot());
  if (!opts.json) {
    console.log(`${c.bold}mnemex suggest-links${c.reset}\n`);
    step(`Wiki root: ${wiki}`);
  }

  const script = join(wiki, "scripts", "suggest-links.mjs");
  if (!existsSync(script)) {
    err(`suggest-links.mjs not found at ${script}`);
    console.log(`   ${c.dim}Run 'mnemex init ${wiki}' first.${c.reset}`);
    process.exit(2);
  }

  const args = [script, "--wiki", wiki];
  if (opts.collection) args.push("--collection", opts.collection);
  if (opts.n) args.push("--n", opts.n);
  if (opts.minScore) args.push("--min-score", opts.minScore);
  if (opts.json) args.push("--json");
  for (const p of pages) args.push("--page", p);
  const r = spawnSync("node", args, { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
