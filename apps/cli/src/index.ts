import { runInspectCommand } from './commands/inspect.ts';
import { runAddCommand } from './commands/add.ts';
import { runSearchCommand } from './commands/search.ts';
import { runContextCommand } from './commands/context.ts';
import { runInitCommand } from './commands/init.ts';
import { runUpdateCommand } from './commands/update.ts';
import { runApiCommand } from './commands/api.ts';
import { runExamplesCommand } from './commands/examples.ts';
import { runPitfallsCommand } from './commands/pitfalls.ts';
import { runRecipesCommand } from './commands/recipes.ts';
import { runMcpCommand } from './commands/mcp.ts';
import { runVerifyCommand } from './commands/verify.ts';
import { runDiffCommand } from './commands/diff.ts';
import { runImpactCommand } from './commands/impact.ts';
import { runDashboardCommand } from './commands/dashboard.ts';
import { runExportCommand } from './commands/export.ts';
import { handleEvaluateCommand } from './commands/evaluate.ts';
import type { ChunkType, PitfallKind } from '../../../packages/shared/src/index.ts';

const VERSION = '0.1.1';

function printHelp(): void {
  console.log(`
DocOrbit — The Documentation Intelligence Layer for Coding Agents
Version: ${VERSION}

USAGE:
  docorbit <command> [options]

COMMANDS:
  init [dir]        Scan workspace, detect project dependencies, resolve docs, and write docs.lock
  update [pkg]      Update docs.lock dependencies (selective or global refresh)
  inspect <url>     Probe target documentation domain for canonical machine-readable sources
  add <url>         Discover, rank, fetch, normalize, slice, and store documentation into local SQLite
  search "<query>"  Deterministic hybrid search across sliced documentation chunks
  context "<task>"  Pack relevant documentation context optimized for AI coding agent tasks
  api "<query>"     Search and inspect structured API endpoints (OpenAPI / Swagger)
  examples "<task>" Search and filter first-class code examples by language, framework, or task
  pitfalls "<task>" Search explicit warnings, deprecations, breaking changes, and runtime restrictions
  recipes "<goal>"  Deterministically compile evidence-grounded implementation recipes
  verify <code/file>Verify agent code against indexed schemas and detect mismatches/deprecations
  diff [source]     Compare documentation versions and snapshots (detect added/removed/deprecated APIs)
  impact [source]   Analyze impact of doc changes on project workspace files
  dashboard         Launch local zero-dependency web inspection UI and verification playground (alias: ui)
  export [format]   Deterministically export agent guidance files (AGENTS.md, CLAUDE.md, skill.md, llms.txt, docs-map.md)
  eval              Run empirical comparative evaluation benchmark (DocOrbit vs Context7 vs Official Docs Fetch vs Firecrawl)
  mcp               Start agent-native Model Context Protocol (MCP) server (stdio / streamable HTTP)

OPTIONS:
  --project <dir>    Workspace root for project-aware dependency detection (default: current dir)
  --doc-version <v>  Target documentation version filter/boost (e.g. v14, 15.0)
  --from <v>         Base version for documentation diffing / impact analysis (e.g. v14)
  --to <v>           Target version for documentation diffing / impact analysis (e.g. v15)
  --library <lib>    Filter or target specific library (e.g. stripe, next)
  --format <fmt>     Export format: agents.md, claude.md, skill.md, llms.txt, docs-map.md
  --output <path>    Custom output file path for export command
  --stdout           Print exported agent content directly to stdout
  --json             Output results as structured JSON
  --db <path>        Custom SQLite database path (default: .docorbit/docorbit.db)
  --tokens <num>     Token budget for context packaging (default: 3000)
  --limit <num>      Maximum search results to return (default: 10)
  --type <type>      Filter by chunk type: prose, code, api, warning, example, mixed
  --method <method>  Filter API endpoints by HTTP method: get, post, put, delete, patch
  --language <lang>  Filter code examples by language: typescript, python, go, rust, bash
  --framework <fw>   Filter code examples by framework: next, react, express, fastapi, flask
  --kind <kind>      Filter pitfalls by kind: deprecated, removed, breaking_change, server_only, rate_limit, security
  --stdio            Run MCP server over standard I/O (stdin/stdout) (default)
  --port <num>       Port for HTTP server or dashboard (default: 3737 for dashboard)
  --host <ip>        Host to bind HTTP transport / dashboard (default: 127.0.0.1)
  --max-pages <num>  Maximum pages to crawl and ingest (default: 50)
  --allow-localhost  Allow localhost / loopback targets (useful for local development & testing)
  -h, --help         Show this help message
  -v, --version      Show DocOrbit version

EXAMPLES:
  docorbit init .
  docorbit verify "fetch('/v1/charges', { method: 'POST' })" --doc-version v14
  docorbit diff --from v14 --to v15
  docorbit impact --from v14 --to v15 --project .
  docorbit mcp --stdio
  docorbit api "create subscription" --doc-version v1
  docorbit examples "verify webhook signature" --language typescript --framework express
  docorbit pitfalls "server actions" --kind server_only --doc-version v14
  docorbit recipes "Handle webhook signature verification in Next.js" --project .
`);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`DocOrbit v${VERSION}`);
    return;
  }

  const command = args[0];
  const queryArg = args[1]?.startsWith('-') ? undefined : args[1];

  const isJson = args.includes('--json');
  const allowLocalhost = args.includes('--allow-localhost');

  let dbPath: string | undefined;
  const dbIdx = args.indexOf('--db');
  if (dbIdx !== -1 && args[dbIdx + 1]) {
    dbPath = args[dbIdx + 1];
  }

  let projectDir: string | undefined;
  const projIdx = args.indexOf('--project');
  if (projIdx !== -1 && args[projIdx + 1]) {
    projectDir = args[projIdx + 1];
  }

  let docVersion: string | undefined;
  const docVerIdx = args.indexOf('--doc-version');
  if (docVerIdx !== -1 && args[docVerIdx + 1]) {
    docVersion = args[docVerIdx + 1];
  }

  let maxPages: number | undefined;
  const maxPagesIdx = args.indexOf('--max-pages');
  if (maxPagesIdx !== -1 && args[maxPagesIdx + 1]) {
    maxPages = parseInt(args[maxPagesIdx + 1], 10);
  }

  let limit: number | undefined;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  }

  let tokens: number | undefined;
  const tokensIdx = args.indexOf('--tokens');
  if (tokensIdx !== -1 && args[tokensIdx + 1]) {
    tokens = parseInt(args[tokensIdx + 1], 10);
  }

  let chunkType: ChunkType | undefined;
  const typeIdx = args.indexOf('--type');
  if (typeIdx !== -1 && args[typeIdx + 1]) {
    chunkType = args[typeIdx + 1] as ChunkType;
  }

  let method: string | undefined;
  const methodIdx = args.indexOf('--method');
  if (methodIdx !== -1 && args[methodIdx + 1]) {
    method = args[methodIdx + 1];
  }

  let language: string | undefined;
  const langIdx = args.indexOf('--language');
  if (langIdx !== -1 && args[langIdx + 1]) {
    language = args[langIdx + 1];
  }

  let framework: string | undefined;
  const fwIdx = args.indexOf('--framework');
  if (fwIdx !== -1 && args[fwIdx + 1]) {
    framework = args[fwIdx + 1];
  }

  let kind: PitfallKind | undefined;
  const kindIdx = args.indexOf('--kind');
  if (kindIdx !== -1 && args[kindIdx + 1]) {
    kind = args[kindIdx + 1] as PitfallKind;
  }

  const isStdio = args.includes('--stdio');

  let port: number | undefined;
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10);
  }

  let host: string | undefined;
  const hostIdx = args.indexOf('--host');
  if (hostIdx !== -1 && args[hostIdx + 1]) {
    host = args[hostIdx + 1];
  }

  let fromVersion: string | undefined;
  const fromIdx = args.indexOf('--from');
  if (fromIdx !== -1 && args[fromIdx + 1]) {
    fromVersion = args[fromIdx + 1];
  }

  let toVersion: string | undefined;
  const toIdx = args.indexOf('--to');
  if (toIdx !== -1 && args[toIdx + 1]) {
    toVersion = args[toIdx + 1];
  }

  let library: string | undefined;
  const libIdx = args.indexOf('--library');
  if (libIdx !== -1 && args[libIdx + 1]) {
    library = args[libIdx + 1];
  }

  let output: string | undefined;
  const outIdx = args.indexOf('--output');
  if (outIdx !== -1 && args[outIdx + 1]) {
    output = args[outIdx + 1];
  }

  let format: string | undefined;
  const fmtIdx = args.indexOf('--format');
  if (fmtIdx !== -1 && args[fmtIdx + 1]) {
    format = args[fmtIdx + 1];
  }

  let targetSource: string | undefined;
  const srcIdx = args.indexOf('--source');
  if (srcIdx !== -1 && args[srcIdx + 1]) {
    targetSource = args[srcIdx + 1];
  }

  let evalSplit: string | undefined;
  const splitIdx = args.indexOf('--split');
  if (splitIdx !== -1 && args[splitIdx + 1]) {
    evalSplit = args[splitIdx + 1];
  }

  let evalStrategy: string | undefined;
  const stratIdx = args.indexOf('--strategy');
  if (stratIdx !== -1 && args[stratIdx + 1]) {
    evalStrategy = args[stratIdx + 1];
  }

  let evalTask: string | undefined;
  const taskIdx = args.indexOf('--task');
  if (taskIdx !== -1 && args[taskIdx + 1]) {
    evalTask = args[taskIdx + 1];
  }

  const isStdout = args.includes('--stdout');
  const noOpen = args.includes('--no-open');
  const isVerbose = args.includes('--verbose');

  switch (command) {
    case 'init': {
      const targetDir = queryArg || projectDir || '.';
      await runInitCommand(targetDir, { json: isJson, dbPath });
      break;
    }
    case 'update': {
      const targetPkg = queryArg;
      await runUpdateCommand(targetPkg, { json: isJson, dbPath, projectDir });
      break;
    }
    case 'inspect': {
      if (!queryArg) {
        console.error('Error: "inspect" requires a target URL argument.');
        printHelp();
        process.exit(1);
      }
      await runInspectCommand(queryArg, { json: isJson, allowLocalhost });
      break;
    }
    case 'add': {
      if (!queryArg) {
        console.error('Error: "add" requires a target URL argument.');
        printHelp();
        process.exit(1);
      }
      await runAddCommand(queryArg, { json: isJson, dbPath, maxPages, allowLocalhost });
      break;
    }
    case 'search': {
      if (!queryArg) {
        console.error('Error: "search" requires a query string argument.');
        printHelp();
        process.exit(1);
      }
      await runSearchCommand(queryArg, { json: isJson, dbPath, limit, chunkType, docVersion, projectDir });
      break;
    }
    case 'context': {
      if (!queryArg) {
        console.error('Error: "context" requires a task description argument.');
        printHelp();
        process.exit(1);
      }
      await runContextCommand(queryArg, { json: isJson, dbPath, tokens, docVersion, projectDir });
      break;
    }
    case 'api': {
      await runApiCommand(queryArg || '', { method, docVersion, projectDir, limit, json: isJson, dbPath });
      break;
    }
    case 'examples': {
      await runExamplesCommand(queryArg || '', { language, framework, docVersion, projectDir, limit, json: isJson, dbPath });
      break;
    }
    case 'pitfalls': {
      await runPitfallsCommand(queryArg || '', { kind, docVersion, projectDir, limit, json: isJson, dbPath });
      break;
    }
    case 'recipes': {
      if (!queryArg) {
        console.error('Error: "recipes" requires an implementation goal argument.');
        printHelp();
        process.exit(1);
      }
      await runRecipesCommand(queryArg, { docVersion, projectDir, json: isJson, dbPath });
      break;
    }
    case 'mcp': {
      await runMcpCommand({
        stdio: isStdio || !port,
        port,
        host,
        dbPath,
        projectDir,
      });
      break;
    }
    case 'verify':
    case 'check-api': {
      if (!queryArg) {
        console.error('Error: "verify" requires a code snippet or file path argument.');
        printHelp();
        process.exit(1);
      }
      await runVerifyCommand(queryArg, {
        docVersion,
        projectDir,
        library,
        language,
        json: isJson,
        dbPath,
      });
      break;
    }
    case 'diff': {
      await runDiffCommand(queryArg || '', {
        from: fromVersion,
        to: toVersion,
        json: isJson,
        dbPath,
      });
      break;
    }
    case 'impact': {
      await runImpactCommand(queryArg || '', {
        from: fromVersion,
        to: toVersion,
        projectDir,
        json: isJson,
        dbPath,
      });
      break;
    }
    case 'dashboard':
    case 'ui': {
      await runDashboardCommand({
        port,
        host,
        projectDir,
        dbPath,
        noOpen,
      });
      break;
    }
    case 'export': {
      await runExportCommand(queryArg || format, {
        format,
        output,
        stdout: isStdout,
        projectDir,
        docVersion,
        targetSource,
        json: isJson,
        dbPath,
      });
      break;
    }
    case 'eval':
    case 'evaluate':
    case 'benchmark': {
      await handleEvaluateCommand({
        split: evalSplit,
        strategy: evalStrategy,
        task: evalTask,
        output,
        json: isJson,
        verbose: isVerbose,
        simulation: args.includes('--simulation'),
      });
      break;
    }
    default: {
      console.error(`Unknown command: "${command}"\n`);
      printHelp();
      process.exit(1);
    }
  }
}

// Direct CLI invocation
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Fatal DocOrbit Error:', err);
    process.exit(1);
  });
}
