import { RecipeEngine } from '../../../retrieval/src/index.ts';
import type { CallToolResult, McpTool } from '../types.ts';
import type { McpContext, McpToolHandler } from './types.ts';

export class FindRecipeTool implements McpToolHandler {
  readonly definition: McpTool = {
    name: 'find_recipe',
    description: 'Assemble an evidence-grounded implementation recipe with explicit prerequisites, ordered steps, and validation steps.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'The implementation goal or workflow to construct a recipe for.',
        },
        version: {
          type: 'string',
          description: 'Target documentation version.',
        },
        projectPath: {
          type: 'string',
          description: 'Workspace root for project-aware dependency detection.',
        },
      },
      required: ['goal'],
    },
  };

  async execute(args: Record<string, unknown>, ctx: McpContext): Promise<CallToolResult> {
    const goal = (
      typeof args.goal === 'string' ? args.goal :
      typeof args.task === 'string' ? args.task :
      typeof args.query === 'string' ? args.query :
      typeof args.workflow === 'string' ? args.workflow :
      typeof args.description === 'string' ? args.description :
      typeof args.search === 'string' ? args.search : ''
    ).trim();

    if (!goal) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'Missing required parameter: goal (or task, query, workflow)' }) }],
      };
    }

    const version = typeof args.docVersion === 'string'
      ? args.docVersion
      : (typeof args.version === 'string' ? args.version : undefined);
    const projectPath = typeof args.projectPath === 'string'
      ? args.projectPath
      : (typeof args.project === 'string' ? args.project : (ctx.projectDir || ctx.workspaceRoot || '.'));

    const engine = new RecipeEngine(ctx.repo);
    const recipe = await engine.assembleRecipe(goal, {
      docVersion: version,
      projectDir: projectPath,
    });

    const lines: string[] = [
      `### Implementation Recipe: ${recipe.goal}`,
      `**Confidence**: ${Math.round(recipe.confidence * 100)}%${recipe.docVersion ? ` | **Version**: \`${recipe.docVersion}\`` : ''}\n`,
    ];

    if (recipe.prerequisites.length > 0) {
      lines.push('#### Prerequisites');
      for (const p of recipe.prerequisites) {
        lines.push(`- [${p.evidenceLevel === 'documented_fact' ? 'FACT' : 'INFERRED'}] ${p.text}`);
      }
      lines.push('');
    }

    if (recipe.orderedSteps.length > 0) {
      lines.push('#### Implementation Steps');
      for (const s of recipe.orderedSteps) {
        const badge = s.evidenceLevel === 'documented_fact' ? 'FACT' : (s.evidenceLevel === 'missing_information' ? 'MISSING' : 'INFERRED');
        lines.push(`${s.step}. **[${badge}] ${s.title}**`);
        if (s.apiEndpoint) lines.push(`   - Endpoint: \`${s.apiEndpoint}\``);
        lines.push(`   - ${s.description}`);
      }
      lines.push('');
    }

    if (recipe.validationSteps.length > 0) {
      lines.push('#### Validation Steps');
      for (const vs of recipe.validationSteps) {
        lines.push(`${vs.step}. **[FACT]** ${vs.description}`);
        if (vs.expectedResponse) lines.push(`   - Expected: \`${vs.expectedResponse}\``);
      }
      lines.push('');
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            markdown: lines.join('\n'),
            data: recipe,
          }, null, 2),
        },
      ],
    };
  }
}
