import type {
  ApiEndpoint,
  Pitfall,
  Recipe,
  ProjectDependency,
  VersionResolutionResult,
} from '../../shared/src/index.ts';

export interface AgentsMdExportData {
  projectDir?: string;
  docVersion?: string;
  dependencies: Array<{
    dep: ProjectDependency;
    resolution?: VersionResolutionResult;
  }>;
  endpoints: ApiEndpoint[];
  pitfalls: Pitfall[];
  recipes: Recipe[];
  sources: string[];
}

/**
 * Generates an AGENTS.md document grounded strictly in indexed documentation.
 * Preserves exact versions, endpoint signatures, critical caveats, and provenance.
 * Fully deterministic output.
 */
export function generateAgentsMd(data: AgentsMdExportData): string {
  const lines: string[] = [];

  lines.push('# AGENTS.md — Documentation & Version Intelligence Context');
  lines.push('');
  lines.push('> [!NOTE]');
  lines.push('> **Strict Evidence-Grounding**: All API signatures, version constraints, and pitfalls in this document');
  lines.push('> are extracted deterministically from indexed documentation. External documentation content is treated');
  lines.push('> as untrusted input (`untrusted: true`).');
  lines.push('');

  // 1. Version Matrix & Dependencies
  lines.push('## 1. Project Dependencies & Version Matrix');
  lines.push('');
  if (data.dependencies.length > 0) {
    lines.push('| Dependency | Ecosystem | Requested | Resolved / Doc Version | Match Type | Confidence |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');

    const sortedDeps = [...data.dependencies].sort((a, b) => a.dep.name.localeCompare(b.dep.name));
    for (const item of sortedDeps) {
      const dep = item.dep;
      const res = item.resolution;
      const resolved = res?.targetVersion || dep.resolvedVersion || 'unresolved';
      const matchType = res?.matchedBy || (res?.targetVersion ? 'resolved' : 'unresolved');
      const conf = res ? `${(res.confidence * 100).toFixed(0)}%` : 'N/A';
      lines.push(`| \`${dep.name}\` | ${dep.ecosystem} | \`${dep.requestedVersion}\` | \`${resolved}\` | \`${matchType}\` | ${conf} |`);
    }
    lines.push('');
  } else if (data.docVersion) {
    lines.push(`- **Target Documentation Version Filter**: \`${data.docVersion}\``);
    lines.push('');
  } else {
    lines.push('- *No local package manifests detected; using globally indexed documentation.*');
    lines.push('');
  }

  // 2. Core API Contracts
  lines.push('## 2. Core API Contracts & Signatures');
  lines.push('');
  if (data.endpoints.length > 0) {
    const sortedEndpoints = [...data.endpoints].sort((a, b) => {
      const cmp = a.path.localeCompare(b.path);
      return cmp !== 0 ? cmp : a.method.localeCompare(b.method);
    });

    for (const ep of sortedEndpoints) {
      const depBadge = ep.deprecated ? ' `[DEPRECATED]`' : '';
      const versionTag = ep.docVersion ? ` (version: \`${ep.docVersion}\`)` : '';
      lines.push(`### \`${ep.method.toUpperCase()} ${ep.path}\`${depBadge}${versionTag}`);
      if (ep.summary) {
        lines.push(`${ep.summary}`);
      }
      lines.push('');

      if (ep.parameters && ep.parameters.length > 0) {
        lines.push('**Parameters:**');
        const sortedParams = [...ep.parameters].sort((a, b) => a.name.localeCompare(b.name));
        for (const p of sortedParams) {
          const req = p.required ? '**required**' : 'optional';
          const type = p.type || 'string';
          const desc = p.description ? ` — ${p.description}` : '';
          lines.push(`- \`${p.name}\` (\`${p.in}\`, ${req}, type: \`${type}\`)${desc}`);
        }
        lines.push('');
      }

      if (ep.requestSchema) {
        lines.push('**Request Body Schema:**');
        lines.push('```json');
        lines.push(JSON.stringify(ep.requestSchema, null, 2));
        lines.push('```');
        lines.push('');
      }

      if (ep.responseSchema) {
        lines.push('**Response Schema:**');
        lines.push('```json');
        lines.push(JSON.stringify(ep.responseSchema, null, 2));
        lines.push('```');
        lines.push('');
      }
    }
  } else {
    lines.push('- *No structured API endpoints indexed for this version/scope.*');
    lines.push('');
  }

  // 3. Critical Pitfalls & Breaking Changes
  lines.push('## 3. Critical Pitfalls & Breaking Changes');
  lines.push('');
  if (data.pitfalls.length > 0) {
    const sortedPitfalls = [...data.pitfalls].sort((a, b) => {
      const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
      const sA = severityOrder[a.severity || 'warning'] ?? 1;
      const sB = severityOrder[b.severity || 'warning'] ?? 1;
      if (sA !== sB) return sA - sB;
      return a.title.localeCompare(b.title);
    });

    for (const pf of sortedPitfalls) {
      const kindLabel = pf.kind.toUpperCase().replace('_', ' ');
      const versionInfo = pf.affectedVersions?.target || pf.docVersion ? ` (Version: \`${pf.affectedVersions?.target || pf.docVersion}\`)` : '';
      lines.push(`### [${kindLabel}] ${pf.title}${versionInfo}`);
      lines.push(`- **Severity**: \`${pf.severity || 'warning'}\``);
      lines.push(`- **Evidence**: ${pf.message}`);
      if (pf.mitigation) {
        lines.push(`- **Mitigation**: ${pf.mitigation}`);
      }
      if (pf.provenance?.sourceUrl) {
        lines.push(`- **Provenance**: [${pf.provenance.sourceUrl}](${pf.provenance.sourceUrl})`);
      }
      lines.push('');
    }
  } else {
    lines.push('- *No explicit pitfalls or warnings indexed for this version/scope.*');
    lines.push('');
  }

  // 4. Grounded Recipes
  if (data.recipes.length > 0) {
    lines.push('## 4. Evidence-Grounded Implementation Recipes');
    lines.push('');
    for (const r of data.recipes) {
      lines.push(`### Recipe: ${r.title}`);
      lines.push(`**Goal**: ${r.goal}`);
      lines.push('');
      if (r.prerequisites.length > 0) {
        lines.push('**Prerequisites:**');
        for (const pre of r.prerequisites) {
          const evidenceTag = pre.evidenceLevel === 'documented_fact' ? '`[DOCUMENTED FACT]`' : '`[INFERRED]`';
          lines.push(`- ${evidenceTag} ${pre.description}`);
        }
        lines.push('');
      }

      if (r.steps.length > 0) {
        lines.push('**Implementation Steps:**');
        for (const step of r.steps) {
          const evidenceTag = step.evidenceLevel === 'documented_fact' ? '`[DOCUMENTED FACT]`' : '`[INFERRED]`';
          lines.push(`${step.stepNumber}. ${evidenceTag} **${step.title}**: ${step.action}`);
          if (step.codeSnippet) {
            lines.push('   ```' + (step.codeSnippet.language || 'typescript'));
            lines.push(step.codeSnippet.code.trim().split('\n').map(l => '   ' + l).join('\n'));
            lines.push('   ```');
          }
        }
        lines.push('');
      }

      if (r.validationSteps.length > 0) {
        lines.push('**Evidence-Based Validation Steps:**');
        for (const val of r.validationSteps) {
          lines.push(`- **Verify**: ${val.assertion} (Expected: \`${val.expectedOutcome}\`)`);
        }
        lines.push('');
      }
    }
  }

  // 5. Provenance & Security Notice
  lines.push('## 5. Indexed Sources & Provenance');
  lines.push('');
  if (data.sources.length > 0) {
    const sortedSources = [...data.sources].sort();
    for (const src of sortedSources) {
      lines.push(`- Source: \`${src}\` (Status: \`indexed\`, Security: \`untrusted: true\`)`);
    }
  } else {
    lines.push('- *No sources indexed.*');
  }
  lines.push('');

  return lines.join('\n');
}
