import * as fs from 'node:fs';
import { DocOrbitDb, DocOrbitRepository, resolveDefaultDbPath } from '../../../../packages/storage/src/index.ts';
import { VerificationService } from '../../../../packages/verification/src/index.ts';
import type { VerifyCommandOptions } from '../../../../packages/shared/src/index.ts';
import { formatVerificationReport } from '../formatters/terminal.ts';

export async function runVerifyCommand(codeOrFile: string = '', options: VerifyCommandOptions = {}): Promise<void> {
  if (!codeOrFile) {
    console.error('Error: "verify" command requires code snippet or file path as an argument.');
    process.exit(1);
  }

  let code = codeOrFile;
  let filePath: string | undefined;

  // Check if argument is a file path
  if (fs.existsSync(codeOrFile) && fs.statSync(codeOrFile).isFile()) {
    filePath = codeOrFile;
    code = fs.readFileSync(codeOrFile, 'utf8');
  }

  const dbPath = resolveDefaultDbPath(options.dbPath, options.projectDir);
  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);

  try {
    const service = new VerificationService(repo);
    const { result } = service.verifyCode({
      code,
      filePath,
      language: options.language,
      library: options.library,
      version: options.docVersion,
      projectDir: options.projectDir || process.cwd(),
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatVerificationReport(result));
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Verify Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
