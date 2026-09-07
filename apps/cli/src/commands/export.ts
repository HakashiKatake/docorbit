import path from 'node:path';
import { DocOrbitDb, DocOrbitRepository } from '../../../../packages/storage/src/index.ts';
import { ExportService } from '../../../../packages/export/src/index.ts';
import type { ExportFormat } from '../../../../packages/shared/src/index.ts';
import { c } from '../formatters/colors.ts';

export interface ExportCommandOptions {
  format?: string;
  output?: string;
  stdout?: boolean;
  projectDir?: string;
  docVersion?: string;
  targetSource?: string;
  json?: boolean;
  dbPath?: string;
}

export async function runExportCommand(
  formatArg?: string,
  options: ExportCommandOptions = {}
): Promise<void> {
  const rawFormat = (formatArg || options.format || 'agents.md').toLowerCase();
  const validFormats: ExportFormat[] = ['agents.md', 'claude.md', 'skill.md', 'llms.txt', 'docs-map.md'];

  let format: ExportFormat = 'agents.md';
  if (validFormats.includes(rawFormat as ExportFormat)) {
    format = rawFormat as ExportFormat;
  } else if (rawFormat === 'agents' || rawFormat === 'agent') {
    format = 'agents.md';
  } else if (rawFormat === 'claude') {
    format = 'claude.md';
  } else if (rawFormat === 'skill') {
    format = 'skill.md';
  } else if (rawFormat === 'llms' || rawFormat === 'llms.txt') {
    format = 'llms.txt';
  } else if (rawFormat === 'map' || rawFormat === 'docs-map') {
    format = 'docs-map.md';
  }

  const projectDir = options.projectDir ? path.resolve(options.projectDir) : process.cwd();
  const dbPath = options.dbPath || path.join(projectDir, '.docorbit', 'docorbit.db');

  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);
  const service = new ExportService(repo);

  try {
    if (options.stdout) {
      const result = await service.generateExport({
        format,
        projectDir,
        docVersion: options.docVersion,
        targetSource: options.targetSource,
        stdout: true,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        process.stdout.write(result.content);
      }
      return;
    }

    const result = await service.writeExport({
      format,
      projectDir,
      docVersion: options.docVersion,
      targetSource: options.targetSource,
      outputPath: options.output,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`\n${c.bold(c.green('✓'))} Generated ${c.bold(format)} for coding agents`);
    console.log(`  ${c.dim('Output file:')}      ${c.cyan(result.outputPath || 'stdout')}`);
    console.log(`  ${c.dim('Doc Version:')}      ${result.metadata.docVersion || 'global/latest'}`);
    console.log(`  ${c.dim('Estimated Tokens:')} ~${result.metadata.tokenEstimate.toLocaleString()}`);
    console.log(`  ${c.dim('APIs Included:')}    ${result.metadata.totalApis}`);
    console.log(`  ${c.dim('Pitfalls Included:')}${result.metadata.totalPitfalls}`);
    console.log(`  ${c.dim('Indexed Sources:')}  ${result.metadata.sources.length}`);
    console.log(`  ${c.dim('Security Boundary:')}${c.yellow('untrusted documentation preserved')}\n`);
  } finally {
    db.close();
  }
}
