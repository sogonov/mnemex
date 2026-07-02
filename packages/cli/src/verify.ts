import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { c, err, step, defaultWikiRoot } from "./util.js";

/**
 * Produce the claim-verification worksheet. Delegates to the bundled
 * scripts/verify-claims.mjs (the source of truth): for every claim carrying a
 * `^[raw:Lstart-Lend]` token it slices the exact cited raw lines and pairs them
 * with the claim, so a fresh-context agent can judge support without re-reading
 * the book. This is the semantic layer above `mnemex lint` (which only checks
 * that tokens resolve). Judgment stays with the agent — see the wiki CLAUDE.md.
 */
export function verify(opts: { wiki?: string; json?: boolean; page?: string }): void {
  const wiki = resolve(opts.wiki || defaultWikiRoot());
  if (!opts.json) {
    console.log(`${c.bold}mnemex verify${c.reset}\n`);
    step(`Wiki root: ${wiki}`);
  }

  const script = join(wiki, "scripts", "verify-claims.mjs");
  if (!existsSync(script)) {
    err(`verify-claims.mjs not found at ${script}`);
    console.log(`   ${c.dim}Run 'mnemex init ${wiki}' first.${c.reset}`);
    process.exit(2);
  }

  const scriptArgs = [script, "--wiki", wiki];
  if (opts.json) scriptArgs.push("--json");
  if (opts.page) scriptArgs.push("--page", opts.page);
  const r = spawnSync("node", scriptArgs, { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
