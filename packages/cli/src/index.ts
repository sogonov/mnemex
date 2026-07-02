#!/usr/bin/env node
import { Command } from "commander";
import { init } from "./init.js";
import { doctor } from "./doctor.js";
import { mcpInstall, mcpStatus } from "./mcp.js";
import { setupSearch, reindex, search } from "./search.js";
import { lint } from "./lint.js";
import { verify } from "./verify.js";

const program = new Command();

program
  .name("mnemex")
  .description("Scaffold and manage an LLM-curated personal knowledge wiki.")
  .version("0.1.2");

program
  .command("init")
  .argument("[dir]", "Target directory (default: ~/mnemex)")
  .description("Create a new wiki from the template")
  .action((dir) => init(dir));

program
  .command("doctor")
  .description("Check that required tools (node, pandoc, git, chromium) are installed")
  .action(() => doctor());

const mcp = program.command("mcp").description("MCP server setup helpers");

mcp
  .command("install")
  .description("Print MCP setup instructions (Claude Desktop + Claude Code)")
  .option("--wiki <path>", "Wiki root path")
  .option("--annas-key <key>", "Anna's Archive secret key (optional)")
  .action((opts) => mcpInstall(opts));

mcp
  .command("status")
  .description("Show where the wiki and Claude config are expected")
  .option("--wiki <path>", "Wiki root path")
  .action((opts) => mcpStatus(opts));

program
  .command("setup-search")
  .description("Install qmd and index your wiki for semantic + keyword search")
  .option("--wiki <path>", "Wiki root path")
  .action((opts) => setupSearch(opts));

program
  .command("reindex")
  .description("Refresh the search index after adding or editing pages")
  .action(() => reindex());

program
  .command("search")
  .argument("<query>", "What to search for")
  .description("Search your wiki from the terminal (wraps qmd query)")
  .action((query) => search(query));

program
  .command("lint")
  .description("Check wiki health: claim-level provenance + wikilink integrity")
  .option("--wiki <path>", "Wiki root path")
  .option("--json", "Emit findings as JSON")
  .option("--strict", "Fail on orphan pages too (advisory by default)")
  .action((opts) => lint(opts));

program
  .command("verify")
  .description("Claim-verification worksheet: pair each claim with its exact cited raw lines")
  .option("--wiki <path>", "Wiki root path")
  .option("--json", "Emit worksheet as JSON")
  .option("--page <rel>", "Limit to one page (e.g. sources/DDD-Evans.md)")
  .action((opts) => verify(opts));

program.parseAsync(process.argv);
