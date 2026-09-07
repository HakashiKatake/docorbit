import path from 'node:path';
import { DocOrbitDb, DocOrbitRepository } from '../../../../packages/storage/src/index.ts';
import { DashboardServer } from '../../../../packages/core/src/index.ts';
import { c } from '../formatters/colors.ts';

export interface DashboardCommandOptions {
  port?: number;
  host?: string;
  projectDir?: string;
  dbPath?: string;
  noOpen?: boolean;
}

export async function runDashboardCommand(options: DashboardCommandOptions = {}): Promise<void> {
  const projectDir = options.projectDir ? path.resolve(options.projectDir) : process.cwd();
  const dbPath = options.dbPath || path.join(projectDir, '.docorbit', 'docorbit.db');
  const port = options.port || 3737;
  const host = options.host || '127.0.0.1';

  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);

  const server = new DashboardServer({
    repo,
    projectDir,
    dbPath,
  });

  try {
    const info = await server.start(port, host);
    console.log(`\n${c.bold(c.cyan('DocOrbit Local Dashboard'))}`);
    console.log(`${c.dim('Documentation Intelligence & Verification Layer')}\n`);
    console.log(`  ${c.green('●')} Server running at: ${c.bold(c.underline(info.url))}`);
    console.log(`  ${c.dim('Database:')} ${dbPath}`);
    console.log(`  ${c.dim('Workspace:')} ${projectDir}`);
    console.log(`  ${c.dim('Security:')} ${c.yellow('untrusted documentation boundary enforced')}\n`);
    console.log(c.dim('Press Ctrl+C to stop.\n'));

    // Keep process alive until interrupted
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        console.log(`\n${c.dim('Stopping dashboard server...')}`);
        await server.stop();
        db.close();
        resolve();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  } catch (err: any) {
    db.close();
    console.error(c.red(`Failed to start dashboard server: ${err.message}`));
    process.exit(1);
  }
}
