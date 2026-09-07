import { DocOrbitDb, DocOrbitRepository } from '../../../../packages/storage/src/index.ts';
import { RecipeEngine } from '../../../../packages/retrieval/src/index.ts';
import type { RecipesCommandOptions } from '../../../../packages/shared/src/index.ts';
import { formatRecipe } from '../formatters/terminal.ts';

export async function runRecipesCommand(goal: string, options: RecipesCommandOptions = {}): Promise<void> {
  if (!goal) {
    console.error('Error: Please provide an implementation goal.');
    console.error('Usage: docorbit recipes "<goal>" [--doc-version <ver>] [--project <dir>] [--json] [--db <path>]');
    process.exit(1);
  }

  const dbPath = options.dbPath || '.docorbit/docorbit.db';
  const db = new DocOrbitDb(dbPath);
  const repository = new DocOrbitRepository(db);
  const recipeEngine = new RecipeEngine(repository);

  try {
    const recipe = await recipeEngine.assembleRecipe(goal, {
      docVersion: options.docVersion,
      projectDir: options.projectDir,
    });

    if (options.json) {
      console.log(JSON.stringify(recipe, null, 2));
    } else {
      console.log(formatRecipe(recipe));
    }
  } catch (err: unknown) {
    console.error(`DocOrbit Recipes Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
