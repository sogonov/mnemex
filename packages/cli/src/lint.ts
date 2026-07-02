import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { c, err, step, defaultWikiRoot } from "./util.js";

/**
 * Run the wiki's claim-level provenance lint. Delegates to the bundled
 * scripts/lint-citations.mjs (the source of truth), mirroring setup-search.
 */
export function lint(opts: { wiki?: string; json?: boolean }): void {
  const wiki = resolve(opts.wiki || defaultWikiRoot());
  if (!opts.json) {
    console.log(`${c.bold}mnemex lint${c.reset}\n`);
    step(`Wiki root: ${wiki}`);
  }

  const script = join(wiki, "scripts", "lint-citations.mjs");
  if (!existsSync(script)) {
    err(`lint-citations.mjs not found at ${script}`);
    console.log(`   ${c.dim}Run 'mnemex init ${wiki}' first.${c.reset}`);
    process.exit(2);
  }

  const scriptArgs = [script, "--wiki", wiki];
  if (opts.json) scriptArgs.push("--json");
  const r = spawnSync("node", scriptArgs, { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
