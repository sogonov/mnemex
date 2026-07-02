import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { c, err, step, defaultWikiRoot } from "./util.js";

/**
 * Retrofit the conversion pipeline (extract-meta → strip-boilerplate → structure →
 * breadcrumb) onto already-ingested books. Delegates to the bundled
 * scripts/clean-raw.mjs (the source of truth). Idempotent — safe to re-run.
 */
export function cleanRaw(opts: {
  wiki?: string; dryRun?: boolean; keepBoilerplate?: boolean;
  structure?: boolean; breadcrumb?: boolean; meta?: boolean;
}): void {
  // breadcrumb is opt-in (a 3-arm test found no retrieval benefit — see eval/BASELINE.md)
  const wiki = resolve(opts.wiki || defaultWikiRoot());
  console.log(`${c.bold}mnemex clean-raw${c.reset}\n`);
  step(`Wiki root: ${wiki}`);

  const script = join(wiki, "scripts", "clean-raw.mjs");
  if (!existsSync(script)) {
    err(`clean-raw.mjs not found at ${script}`);
    console.log(`   ${c.dim}Run 'mnemex init ${wiki}' first.${c.reset}`);
    process.exit(2);
  }

  const args = [script, "--wiki", wiki];
  if (opts.dryRun) args.push("--dry-run");
  if (opts.keepBoilerplate) args.push("--keep-boilerplate");
  if (opts.structure === false) args.push("--no-structure");
  if (opts.breadcrumb) args.push("--breadcrumb");
  if (opts.meta === false) args.push("--no-meta");
  const r = spawnSync("node", args, { stdio: "inherit" });
  process.exit(r.status ?? 0);
}
