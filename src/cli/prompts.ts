import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { c } from './formatters/colors.ts';

export type StorageLocation = 'project' | 'global';

export async function promptStorageLocation(projectPathHint?: string): Promise<StorageLocation> {
  // If not running in an interactive terminal, default safely to project-local
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return 'project';
  }

  const rl = readline.createInterface({ input, output });

  try {
    console.log(`\n${c.bold(c.cyan('?'))} ${c.bold('Where would you like to store DocOrbit documentation?')}`);
    console.log(`  ${c.cyan('1)')} ${c.bold('Project-local')} ${c.dim(`(.docorbit/ in project root)`)} ${c.green('[Recommended - zero disk leak]')}`);
    console.log(`  ${c.cyan('2)')} ${c.bold('Global')} ${c.dim(`(~/.docorbit/ in user home directory)`)}`);
    console.log(`  ${c.dim('Tip: Pass -p / --project or -g / --global to skip this question in future.')}\n`);

    const answer = await rl.question(`${c.bold('Select storage location [1/2] (default: 1): ')}`);
    const trimmed = answer.trim().toLowerCase();

    if (trimmed === '2' || trimmed === 'g' || trimmed === 'global') {
      console.log(`${c.dim('Selected:')} ${c.yellow('Global store (~/.docorbit/docorbit.db)\n')}`);
      return 'global';
    }

    console.log(`${c.dim('Selected:')} ${c.green('Project-local store (.docorbit/docorbit.db)\n')}`);
    return 'project';
  } finally {
    rl.close();
  }
}
