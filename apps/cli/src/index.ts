import { runInspectCommand } from './commands/inspect.ts';
import { runAddCommand } from './commands/add.ts';

const VERSION = '0.1.0';

function printHelp(): void {
  console.log(`
DocRouter — The Documentation Intelligence Layer for Coding Agents
Version: ${VERSION}

USAGE:
  docrouter <command> [options]

COMMANDS:
  inspect <url>    Probe target documentation domain for canonical machine-readable sources
  add <url>        Discover, rank, fetch, normalize, and store documentation into local SQLite

OPTIONS:
  --json             Output results as structured JSON
  --db <path>        Custom SQLite database path (default: .docrouter/docrouter.db)
  --max-pages <num>  Maximum pages to crawl and ingest (default: 50)
  --allow-localhost  Allow localhost / loopback targets (useful for local development & testing)
  -h, --help         Show this help message
  -v, --version      Show DocRouter version

EXAMPLES:
  docrouter inspect https://docs.example.com
  docrouter inspect https://docs.example.com --json
  docrouter add https://docs.example.com
  docrouter add https://docs.example.com --db ./mydb.sqlite
`);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    return;
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`DocRouter v${VERSION}`);
    return;
  }

  const command = args[0];
  const urlArg = args[1]?.startsWith('-') ? undefined : args[1];

  const isJson = args.includes('--json');
  const allowLocalhost = args.includes('--allow-localhost');

  let dbPath: string | undefined;
  const dbIdx = args.indexOf('--db');
  if (dbIdx !== -1 && args[dbIdx + 1]) {
    dbPath = args[dbIdx + 1];
  }

  let maxPages: number | undefined;
  const maxPagesIdx = args.indexOf('--max-pages');
  if (maxPagesIdx !== -1 && args[maxPagesIdx + 1]) {
    maxPages = parseInt(args[maxPagesIdx + 1], 10);
  }

  switch (command) {
    case 'inspect': {
      if (!urlArg) {
        console.error('Error: "inspect" requires a target URL argument.');
        printHelp();
        process.exit(1);
      }
      await runInspectCommand(urlArg, { json: isJson, allowLocalhost });
      break;
    }
    case 'add': {
      if (!urlArg) {
        console.error('Error: "add" requires a target URL argument.');
        printHelp();
        process.exit(1);
      }
      await runAddCommand(urlArg, { json: isJson, dbPath, maxPages, allowLocalhost });
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
    console.error('Fatal DocRouter Error:', err);
    process.exit(1);
  });
}
