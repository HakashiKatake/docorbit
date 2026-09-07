import type {
  ApiEndpoint,
  Pitfall,
  Recipe,
} from '../../shared/src/index.ts';

export interface SkillMdExportData {
  skillName?: string;
  docVersion?: string;
  endpoints: ApiEndpoint[];
  pitfalls: Pitfall[];
  recipes: Recipe[];
  sources: string[];
}

/**
 * Generates a skill.md file compatible with AI agent skill systems.
 * Embeds YAML frontmatter, deterministic recipes, and verified schemas.
 */
export function generateSkillMd(data: SkillMdExportData): string {
  const lines: string[] = [];
  const skillName = data.skillName || 'docorbit-implementation-skill';
  const version = data.docVersion || '0.1.0';

  // Frontmatter
  lines.push('---');
  lines.push(`name: ${skillName}`);
  lines.push('description: Evidence-grounded documentation intelligence and API implementation recipes.');
  lines.push(`version: ${version}`);
  lines.push('untrusted_documentation: true');
  lines.push('grounding: strict_evidence');
  lines.push('---');
  lines.push('');

  lines.push(`# Skill: ${skillName} (${version})`);
  lines.push('');
  lines.push('This agent skill contains deterministic recipes and verified API signatures generated from authoritative');
  lines.push('documentation. Never fabricate undocumented steps or validation rules.');
  lines.push('');

  // 1. Recipes
  lines.push('## 1. Actionable Implementation Recipes');
  lines.push('');
  if (data.recipes.length > 0) {
    for (const r of data.recipes) {
      lines.push(`### Recipe: ${r.title}`);
      lines.push(`- **Goal**: ${r.goal}`);
      lines.push(`- **Evidence Status**: ${r.evidenceLevels.strictGrounded ? 'Grounded' : 'Partial'}`);
      lines.push('');

      if (r.prerequisites.length > 0) {
        lines.push('**Prerequisites:**');
        for (const pre of r.prerequisites) {
          lines.push(`- [${pre.evidenceLevel}] ${pre.description}`);
        }
        lines.push('');
      }

      if (r.steps.length > 0) {
        lines.push('**Steps:**');
        for (const step of r.steps) {
          lines.push(`${step.stepNumber}. [${step.evidenceLevel}] **${step.title}**: ${step.action}`);
          if (step.codeSnippet) {
            lines.push('   ```' + (step.codeSnippet.language || 'typescript'));
            lines.push(step.codeSnippet.code.trim().split('\n').map(l => '   ' + l).join('\n'));
            lines.push('   ```');
          }
        }
        lines.push('');
      }

      if (r.validationSteps.length > 0) {
        lines.push('**Evidence-Based Validation:**');
        for (const v of r.validationSteps) {
          lines.push(`- Verify: ${v.assertion} (Expected: \`${v.expectedOutcome}\`)`);
        }
        lines.push('');
      }
    }
  } else {
    lines.push('- *No compiled recipes available for this scope.*');
    lines.push('');
  }

  // 2. API Reference
  lines.push('## 2. API Reference & Schemas');
  lines.push('');
  if (data.endpoints.length > 0) {
    const sortedEndpoints = [...data.endpoints].sort((a, b) => {
      const cmp = a.path.localeCompare(b.path);
      return cmp !== 0 ? cmp : a.method.localeCompare(b.method);
    });

    for (const ep of sortedEndpoints) {
      lines.push(`### \`${ep.method.toUpperCase()} ${ep.path}\``);
      if (ep.summary) lines.push(ep.summary);
      if (ep.parameters && ep.parameters.length > 0) {
        lines.push('Parameters:');
        for (const p of ep.parameters) {
          lines.push(`- \`${p.name}\` (${p.in}, ${p.required ? 'required' : 'optional'})`);
        }
      }
      lines.push('');
    }
  } else {
    lines.push('- *No endpoints indexed.*');
    lines.push('');
  }

  // 3. Known Pitfalls
  lines.push('## 3. Known Pitfalls & Defenses');
  lines.push('');
  if (data.pitfalls.length > 0) {
    const sortedPitfalls = [...data.pitfalls].sort((a, b) => a.title.localeCompare(b.title));
    for (const pf of sortedPitfalls) {
      lines.push(`- **[${pf.kind}] ${pf.title}**: ${pf.message}`);
      if (pf.mitigation) {
        lines.push(`  - Defense: ${pf.mitigation}`);
      }
    }
    lines.push('');
  } else {
    lines.push('- *No pitfalls recorded.*');
    lines.push('');
  }

  return lines.join('\n');
}
