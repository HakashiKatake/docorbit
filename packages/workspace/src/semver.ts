import type {
  DocVersionMatch,
  VersionResolutionResult,
} from '../../shared/src/index.ts';

export interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  raw: string;
}

/**
 * Parses a version string into semantic components.
 * Handles standard SemVer, leading 'v', partial versions ('14', '14.2'),
 * and prereleases ('15.0.0-rc.1', '14.2.0-canary').
 */
export function parseSemVer(versionStr: string): ParsedSemVer | null {
  if (!versionStr || typeof versionStr !== 'string') return null;

  const cleaned = versionStr.trim().replace(/^[v=]/, '');
  // Match major, optional minor, optional patch, optional prerelease
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;

  const major = parseInt(match[1], 10);
  const minor = match[2] !== undefined ? parseInt(match[2], 10) : 0;
  const patch = match[3] !== undefined ? parseInt(match[3], 10) : 0;
  const prerelease = match[4];

  return { major, minor, patch, prerelease, raw: versionStr.trim() };
}

/**
 * Deterministic SemVer comparison.
 * Returns negative if v1 < v2, positive if v1 > v2, 0 if v1 == v2.
 * Prereleases have lower precedence than normal releases (e.g. 15.0.0-rc.1 < 15.0.0).
 */
export function compareVersions(v1: string, v2: string): number {
  const p1 = parseSemVer(v1);
  const p2 = parseSemVer(v2);

  if (!p1 && !p2) return v1.localeCompare(v2);
  if (!p1) return -1;
  if (!p2) return 1;

  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  if (p1.patch !== p2.patch) return p1.patch - p2.patch;

  // Prerelease comparison:
  // 1.0.0-alpha < 1.0.0 (version with prerelease is lower than version without)
  if (p1.prerelease && !p2.prerelease) return -1;
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && p2.prerelease) {
    return p1.prerelease.localeCompare(p2.prerelease);
  }

  return 0;
}

/**
 * Evaluates whether a concrete version satisfies a SemVer range specification.
 * Supports '^', '~', '>=', '<=', '<', '>', '*', 'x', space-separated and '||'.
 */
export function satisfiesRange(version: string, range: string): boolean {
  if (!range || range === '*' || range === 'latest' || range === 'x') {
    return true;
  }

  const ver = parseSemVer(version);
  if (!ver) return false;

  // Handle disjunction (||)
  if (range.includes('||')) {
    return range.split('||').some(r => satisfiesRange(version, r.trim()));
  }

  // Handle conjunction (space separated conditions e.g. ">=14.0.0 <15.0.0")
  const clauses = range.trim().split(/\s+/).filter(Boolean);
  if (clauses.length > 1) {
    return clauses.every(c => satisfiesRange(version, c));
  }

  const single = clauses[0];

  // Caret ranges: ^14.2.0 -> >=14.2.0 <15.0.0 (or for 0.x: ^0.2.3 -> >=0.2.3 <0.3.0)
  if (single.startsWith('^')) {
    const base = parseSemVer(single.slice(1));
    if (!base) return false;
    if (ver.major !== base.major) return false;
    if (base.major === 0) {
      if (ver.minor !== base.minor) return false;
      return ver.patch >= base.patch;
    }
    if (ver.minor < base.minor) return false;
    if (ver.minor === base.minor && ver.patch < base.patch) return false;
    return true;
  }

  // Tilde ranges: ~14.2.0 -> >=14.2.0 <14.3.0
  if (single.startsWith('~')) {
    const base = parseSemVer(single.slice(1));
    if (!base) return false;
    if (ver.major !== base.major || ver.minor !== base.minor) return false;
    return ver.patch >= base.patch;
  }

  // Wildcard ranges: 14.x or 14.*
  const wildcardMatch = single.match(/^(\d+)(?:\.(\d+|\*|x))?(?:\.(\d+|\*|x))?$/);
  if (wildcardMatch) {
    const wMajor = parseInt(wildcardMatch[1], 10);
    const wMinor = wildcardMatch[2];
    if (ver.major !== wMajor) return false;
    if (wMinor && wMinor !== '*' && wMinor !== 'x') {
      if (ver.minor !== parseInt(wMinor, 10)) return false;
    }
    return true;
  }

  // Comparison operators: >=, <=, >, <, =
  const compMatch = single.match(/^(>=|<=|>|<|=)(.+)$/);
  if (compMatch) {
    const op = compMatch[1];
    const target = compMatch[2].trim();
    const cmp = compareVersions(version, target);
    if (op === '>=') return cmp >= 0;
    if (op === '<=') return cmp <= 0;
    if (op === '>') return cmp > 0;
    if (op === '<') return cmp < 0;
    if (op === '=') return cmp === 0;
  }

  // Direct equality check
  const targetVer = parseSemVer(single);
  if (targetVer) {
    return (
      ver.major === targetVer.major &&
      ver.minor === targetVer.minor &&
      ver.patch === targetVer.patch
    );
  }

  return false;
}

/**
 * Deterministically resolves a project's dependency version to the best available
 * documentation version using the hierarchical confidence ladder:
 * exact (1.0) -> major_minor (0.95) -> major (0.90) -> range (0.85) -> latest_fallback (0.50) -> unresolved (0.0)
 *
 * Never claims exact match when documentation is coarse (e.g. 'v14' or 'latest').
 */
export function resolveDocVersion(
  projectVersion: string,
  availableDocVersions: string[],
  dependencyName: string = 'package'
): VersionResolutionResult {
  if (!availableDocVersions || availableDocVersions.length === 0) {
    return {
      dependencyName,
      projectVersion,
      selectedDocVersion: 'unresolved',
      matchType: 'unresolved',
      confidence: 0.0,
      availableVersions: [],
    };
  }

  const cleaned = projectVersion.replace(/^[\^~=v><\s]+/, '');
  const pVer = parseSemVer(projectVersion) || parseSemVer(cleaned);
  const cleanTarget = projectVersion.replace(/^[v=]/, '');

  // 1. Exact match (e.g. project '14.2.3' and doc '14.2.3' or 'v14.2.3')
  const exactMatch = availableDocVersions.find(v => {
    const c = v.replace(/^[v=]/, '');
    return c === cleanTarget;
  });
  if (exactMatch) {
    return {
      dependencyName,
      projectVersion,
      selectedDocVersion: exactMatch,
      matchType: 'exact',
      confidence: 1.0,
      availableVersions: availableDocVersions,
    };
  }

  if (pVer) {
    // 2. Major.Minor match (e.g. project '14.2.3' and doc 'v14.2' or '14.2')
    const mmTarget = `${pVer.major}.${pVer.minor}`;
    const mmMatch = availableDocVersions.find(v => {
      const c = v.replace(/^[v=]/, '');
      return c === mmTarget || c === `${mmTarget}.x`;
    });
    if (mmMatch) {
      return {
        dependencyName,
        projectVersion,
        selectedDocVersion: mmMatch,
        matchType: 'major_minor',
        confidence: 0.95,
        availableVersions: availableDocVersions,
      };
    }

    // 3. Major match (e.g. project '14.2.3' and doc 'v14', '14.x', or '14')
    const majorTarget = `${pVer.major}`;
    const majorMatch = availableDocVersions.find(v => {
      const c = v.replace(/^[v=]/, '');
      return c === majorTarget || c === `${majorTarget}.x` || c === `${majorTarget}.*`;
    });
    if (majorMatch) {
      return {
        dependencyName,
        projectVersion,
        selectedDocVersion: majorMatch,
        matchType: 'major',
        confidence: 0.90,
        availableVersions: availableDocVersions,
      };
    }

    // 4. SemVer range satisfaction (find doc version that satisfies project version range or vice versa)
    const rangeMatch = availableDocVersions
      .filter(v => !['latest', 'stable', 'current', 'main', 'default'].includes(v.toLowerCase()))
      .find(v => {
        return satisfiesRange(projectVersion, v) || satisfiesRange(v, projectVersion);
      });
    if (rangeMatch) {
      return {
        dependencyName,
        projectVersion,
        selectedDocVersion: rangeMatch,
        matchType: 'range',
        confidence: 0.85,
        availableVersions: availableDocVersions,
      };
    }
  }

  // 5. Fallback: 'latest' / 'stable' / 'current' or highest available version
  const latestCandidate = availableDocVersions.find(v =>
    ['latest', 'stable', 'current', 'main', 'default'].includes(v.toLowerCase())
  );

  const fallbackVersion = latestCandidate || availableDocVersions[0];

  return {
    dependencyName,
    projectVersion,
    selectedDocVersion: fallbackVersion,
    matchType: 'latest_fallback',
    confidence: 0.50,
    availableVersions: availableDocVersions,
  };
}
