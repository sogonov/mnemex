import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { c, err, step, defaultWikiRoot } from "./util.js";

/**
 * Run the wiki's health lints. Delegates to the bundled scripts (the source of
 * truth), mirroring setup-search:
 *   - scripts/lint-citations.mjs — claim-level provenance
 *   - scripts/lint-links.mjs     — wikilink integrity (broken / duplicate / orphan)
 * Exit code is the max of the two (non-zero if either found a hard problem).
 */
export function lint(opts: { wiki?: string; json?: boolean; strict?: boolean }): void {
  const wiki = resolve(opts.wiki || defaultWikiRoot());
  if (!opts.json) {
    console.log(`${c.bold}mnemex lint${c.reset}\n`);
    step(`Wiki root: ${wiki}`);
  }

  const checks: Array<{ script: string; args: string[] }> = [
    { script: "lint-citations.mjs", args: [] },
    { script: "lint-links.mjs", args: opts.strict ? ["--strict"] : [] },
  ];

  let worst = 0;
  for (const { script, args } of checks) {
    const path = join(wiki, "scripts", script);
    if (!existsSync(path)) {
      err(`${script} not found at ${path}`);
      console.log(`   ${c.dim}Run 'mnemex init ${wiki}' first.${c.reset}`);
      process.exit(2);
    }
    const scriptArgs = [path, "--wiki", wiki, ...args];
    if (opts.json) scriptArgs.push("--json");
    else console.log(`\n${c.dim}— ${script} —${c.reset}`);
    const r = spawnSync("node", scriptArgs, { stdio: "inherit" });
    worst = Math.max(worst, r.status ?? 0);
  }
  process.exit(worst);
}
