import test from 'node:test';
import assert from 'node:assert';
import {
  parseSemVer,
  compareVersions,
  satisfiesRange,
  resolveDocVersion,
} from '../../packages/workspace/src/semver.ts';

test('SemVer: parseSemVer correctly parses standard, partial, and prerelease versions', () => {
  // Standard semver
  const s1 = parseSemVer('1.2.3');
  assert.strictEqual(s1?.major, 1);
  assert.strictEqual(s1?.minor, 2);
  assert.strictEqual(s1?.patch, 3);
  assert.strictEqual(s1?.prerelease, undefined);

  // Leading 'v' and '='
  const s2 = parseSemVer('v14.2.5');
  assert.strictEqual(s2?.major, 14);
  assert.strictEqual(s2?.minor, 2);
  assert.strictEqual(s2?.patch, 5);

  const s3 = parseSemVer('=2.0.0');
  assert.strictEqual(s3?.major, 2);
  assert.strictEqual(s3?.minor, 0);

  // Partial versions
  const s4 = parseSemVer('14');
  assert.strictEqual(s4?.major, 14);
  assert.strictEqual(s4?.minor, 0);
  assert.strictEqual(s4?.patch, 0);

  const s5 = parseSemVer('14.2');
  assert.strictEqual(s5?.major, 14);
  assert.strictEqual(s5?.minor, 2);
  assert.strictEqual(s5?.patch, 0);

  // Prereleases
  const s6 = parseSemVer('15.0.0-rc.1');
  assert.strictEqual(s6?.major, 15);
  assert.strictEqual(s6?.minor, 0);
  assert.strictEqual(s6?.patch, 0);
  assert.strictEqual(s6?.prerelease, 'rc.1');

  // Malformed / invalid
  assert.strictEqual(parseSemVer(''), null);
  assert.strictEqual(parseSemVer('not-a-version'), null);
  assert.strictEqual(parseSemVer(null as any), null);
});

test('SemVer: compareVersions orders releases and prereleases accurately', () => {
  assert.ok(compareVersions('1.0.0', '2.0.0') < 0);
  assert.ok(compareVersions('2.0.0', '1.0.0') > 0);
  assert.strictEqual(compareVersions('1.4.2', 'v1.4.2'), 0);

  // Minor & patch precedence
  assert.ok(compareVersions('1.2.0', '1.3.0') < 0);
  assert.ok(compareVersions('1.2.1', '1.2.2') < 0);

  // Prerelease precedence: 1.0.0-alpha < 1.0.0
  assert.ok(compareVersions('1.0.0-alpha', '1.0.0') < 0);
  assert.ok(compareVersions('15.0.0-rc.1', '15.0.0') < 0);
  assert.ok(compareVersions('15.0.0', '15.0.0-rc.1') > 0);
});

test('SemVer: satisfiesRange evaluates caret, tilde, comparisons, wildcards, and disjunctions', () => {
  // Caret (^)
  assert.strictEqual(satisfiesRange('14.2.3', '^14.0.0'), true);
  assert.strictEqual(satisfiesRange('15.0.0', '^14.0.0'), false);
  assert.strictEqual(satisfiesRange('0.2.4', '^0.2.0'), true);
  assert.strictEqual(satisfiesRange('0.3.0', '^0.2.0'), false);

  // Tilde (~)
  assert.strictEqual(satisfiesRange('14.2.3', '~14.2.0'), true);
  assert.strictEqual(satisfiesRange('14.3.0', '~14.2.0'), false);

  // Comparisons (>=, <=, >, <)
  assert.strictEqual(satisfiesRange('14.2.0', '>=14.0.0'), true);
  assert.strictEqual(satisfiesRange('13.9.0', '>=14.0.0'), false);
  assert.strictEqual(satisfiesRange('14.2.0', '<15.0.0'), true);
  assert.strictEqual(satisfiesRange('15.0.0', '<15.0.0'), false);

  // Compound ranges (space separated)
  assert.strictEqual(satisfiesRange('14.2.3', '>=14.0.0 <15.0.0'), true);
  assert.strictEqual(satisfiesRange('15.0.1', '>=14.0.0 <15.0.0'), false);

  // Disjunction (||)
  assert.strictEqual(satisfiesRange('14.2.0', '^13.0.0 || ^14.0.0'), true);
  assert.strictEqual(satisfiesRange('15.0.0', '^13.0.0 || ^14.0.0'), false);

  // Wildcards
  assert.strictEqual(satisfiesRange('14.2.3', '14.x'), true);
  assert.strictEqual(satisfiesRange('15.0.0', '14.*'), false);
  assert.strictEqual(satisfiesRange('1.0.0', '*'), true);
  assert.strictEqual(satisfiesRange('1.0.0', 'latest'), true);
});

test('SemVer Confidence Ladder: exact -> major_minor -> major -> range -> latest_fallback -> unresolved', () => {
  const allDocs = ['v14.2.3', 'v14.2', 'v14', '15.0.0', 'latest'];

  // 1. Exact match (confidence 1.0)
  const rExact = resolveDocVersion('14.2.3', allDocs, 'next');
  assert.strictEqual(rExact.matchType, 'exact');
  assert.strictEqual(rExact.selectedDocVersion, 'v14.2.3');
  assert.strictEqual(rExact.confidence, 1.0);

  // 2. Major.Minor match (confidence 0.95)
  const rMajorMinor = resolveDocVersion('14.2.9', ['v14.2', 'v14', 'v15'], 'next');
  assert.strictEqual(rMajorMinor.matchType, 'major_minor');
  assert.strictEqual(rMajorMinor.selectedDocVersion, 'v14.2');
  assert.strictEqual(rMajorMinor.confidence, 0.95);

  // 3. Major match (confidence 0.90) - Never falsely claims exact match for coarse 'v14'!
  const rMajor = resolveDocVersion('14.2.3', ['v14', 'v15', 'v16'], 'next');
  assert.strictEqual(rMajor.matchType, 'major');
  assert.strictEqual(rMajor.selectedDocVersion, 'v14');
  assert.strictEqual(rMajor.confidence, 0.90);

  // 4. SemVer range satisfaction (confidence 0.85)
  const rRange = resolveDocVersion('^14.0.0', ['14.3.1', '15.0.0'], 'next');
  assert.strictEqual(rRange.matchType, 'range');
  assert.strictEqual(rRange.selectedDocVersion, '14.3.1');
  assert.strictEqual(rRange.confidence, 0.85);

  // 5. Fallback to latest / stable (confidence 0.50)
  const rLatest = resolveDocVersion('12.0.0', ['latest', 'v14', 'v15'], 'next');
  assert.strictEqual(rLatest.matchType, 'latest_fallback');
  assert.strictEqual(rLatest.selectedDocVersion, 'latest');
  assert.strictEqual(rLatest.confidence, 0.50);

  // 6. Unresolved (confidence 0.0)
  const rUnresolved = resolveDocVersion('14.0.0', [], 'next');
  assert.strictEqual(rUnresolved.matchType, 'unresolved');
  assert.strictEqual(rUnresolved.selectedDocVersion, 'unresolved');
  assert.strictEqual(rUnresolved.confidence, 0.0);
});
