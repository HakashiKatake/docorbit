import { inspectDocumentation } from '../../../../packages/core/src/index.ts';
import { formatInspectionReport } from '../formatters/terminal.ts';

export interface InspectCommandOptions {
  json?: boolean;
  allowLocalhost?: boolean;
}

export async function runInspectCommand(targetUrl: string, options: InspectCommandOptions = {}): Promise<void> {
  if (!targetUrl) {
    console.error('Error: Please provide a documentation target URL.');
    console.error('Usage: docrouter inspect <url> [--json]');
    process.exit(1);
  }

  try {
    const report = await inspectDocumentation(targetUrl, {
      allowLocalhostForTesting: options.allowLocalhost,
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatInspectionReport(report));
    }
  } catch (err: unknown) {
    console.error(`DocRouter Inspection Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
