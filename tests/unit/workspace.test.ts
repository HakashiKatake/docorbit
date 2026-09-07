import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectWorkspaceDependencies,
  generateDocsLock,
  updateDocsLock,
  readDocsLock,
  writeDocsLock,
  WorkspaceResolver,
} from '../../packages/workspace/src/index.ts';
import { DocOrbitDb, DocOrbitRepository } from '../../packages/storage/src/index.ts';

test('Workspace Detection: accurately scans all 8 ecosystems', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'docorbit-scan-'));

  try {
    // 1. npm: package.json & package-lock.json
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        dependencies: { next: '^14.2.0', react: '^18.3.0' },
        devDependencies: { typescript: '^5.4.0' },
      })
    );
    writeFileSync(
      join(tempDir, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'test-project' },
          'node_modules/next': { version: '14.2.5' },
          'node_modules/react': { version: '18.3.1' },
          'node_modules/typescript': { version: '5.4.5' },
        },
      })
    );

    // 2. Cargo: Cargo.toml & Cargo.lock
    writeFileSync(
      join(tempDir, 'Cargo.toml'),
      `[package]\nname = "my-rust-app"\n\n[dependencies]\ntokio = { version = "1.38", features = ["full"] }\nserde = "1.0"\n`
    );
    writeFileSync(
      join(tempDir, 'Cargo.lock'),
      `version = 3\n\n[[package]]\nname = "tokio"\nversion = "1.38.0"\n\n[[package]]\nname = "serde"\nversion = "1.0.203"\n`
    );

    // 3. Go: go.mod
    writeFileSync(
      join(tempDir, 'go.mod'),
      `module example.com/myapp\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgorm.io/gorm v1.25.7\n)\n`
    );

    // 4. PyPI: requirements.txt & pyproject.toml
    writeFileSync(
      join(tempDir, 'requirements.txt'),
      `fastapi==0.110.0\nuvicorn>=0.28.0\n`
    );
    writeFileSync(
      join(tempDir, 'pyproject.toml'),
      `[project]\nname = "py-app"\n\n[project.dependencies]\npydantic = "^2.6.0"\n`
    );

    // 5. Composer: composer.json
    writeFileSync(
      join(tempDir, 'composer.json'),
      JSON.stringify({
        require: { 'laravel/framework': '^11.0' },
      })
    );

    // 6. RubyGems: Gemfile
    writeFileSync(
      join(tempDir, 'Gemfile'),
      `source 'https://rubygems.org'\n\ngem 'rails', '~> 7.1.3'\n`
    );

    // 7. Pub: pubspec.yaml
    writeFileSync(
      join(tempDir, 'pubspec.yaml'),
      `name: flutter_app\ndependencies:\n  flutter_bloc: ^8.1.3\n`
    );

    // 8. Maven: pom.xml
    writeFileSync(
      join(tempDir, 'pom.xml'),
      `<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId><version>3.2.4</version></dependency></dependencies></project>`
    );

    const scan = detectWorkspaceDependencies(tempDir);

    // Ecosystems verification
    assert.ok(scan.ecosystems.includes('npm'));
    assert.ok(scan.ecosystems.includes('cargo'));
    assert.ok(scan.ecosystems.includes('go'));
    assert.ok(scan.ecosystems.includes('pypi'));
    assert.ok(scan.ecosystems.includes('composer'));
    assert.ok(scan.ecosystems.includes('rubygems'));
    assert.ok(scan.ecosystems.includes('pub'));
    assert.ok(scan.ecosystems.includes('maven'));
    assert.strictEqual(scan.ecosystems.length, 8);

    // Check npm resolved version from package-lock.json
    const nextDep = scan.dependencies.find(d => d.name === 'next');
    assert.ok(nextDep);
    assert.strictEqual(nextDep?.requestedVersion, '^14.2.0');
    assert.strictEqual(nextDep?.resolvedVersion, '14.2.5');

    // Check cargo resolved version from Cargo.lock
    const tokioDep = scan.dependencies.find(d => d.name === 'tokio');
    assert.ok(tokioDep);
    assert.strictEqual(tokioDep?.resolvedVersion, '1.38.0');

    // Check go
    const ginDep = scan.dependencies.find(d => d.name === 'github.com/gin-gonic/gin');
    assert.ok(ginDep);
    assert.strictEqual(ginDep?.resolvedVersion, 'v1.9.1');

    // Check pypi
    const fastapiDep = scan.dependencies.find(d => d.name === 'fastapi');
    assert.ok(fastapiDep);
    assert.strictEqual(fastapiDep?.resolvedVersion, '0.110.0');

    // Check composer
    const laravelDep = scan.dependencies.find(d => d.name === 'laravel/framework');
    assert.ok(laravelDep);

    // Check ruby
    const railsDep = scan.dependencies.find(d => d.name === 'rails');
    assert.ok(railsDep);

    // Check pub
    const blocDep = scan.dependencies.find(d => d.name === 'flutter_bloc');
    assert.ok(blocDep);

    // Check maven
    const springDep = scan.dependencies.find(d => d.name === 'org.springframework.boot:spring-boot-starter-web');
    assert.ok(springDep);
    assert.strictEqual(springDep?.resolvedVersion, '3.2.4');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Workspace Detection: handles monorepos with multiple versions of the same dependency', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'docorbit-monorepo-'));

  try {
    const pkgADir = join(tempDir, 'packages', 'web');
    const pkgBDir = join(tempDir, 'packages', 'admin');
    mkdirSync(pkgADir, { recursive: true });
    mkdirSync(pkgBDir, { recursive: true });

    // Web package uses Next.js 14
    writeFileSync(
      join(pkgADir, 'package.json'),
      JSON.stringify({ dependencies: { next: '14.2.3' } })
    );

    // Admin package uses Next.js 15
    writeFileSync(
      join(pkgBDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '15.0.0-rc.1' } })
    );

    const scan = detectWorkspaceDependencies(tempDir);
    const nextDeps = scan.dependencies.filter(d => d.name === 'next');

    assert.strictEqual(nextDeps.length, 2);
    assert.ok(nextDeps.some(d => d.packagePath === 'packages/web' && d.requestedVersion === '14.2.3'));
    assert.ok(nextDeps.some(d => d.packagePath === 'packages/admin' && d.requestedVersion === '15.0.0-rc.1'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('DocsLock: deterministic lockfile generation and bit-for-bit stability without timestamp churn', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'docorbit-lock-'));
  const db = new DocOrbitDb(':memory:');
  const repo = new DocOrbitRepository(db);

  try {
    // Write workspace manifest
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '14.2.3' } })
    );

    // Save source and snapshots in repository
    const srcId = repo.saveSource({
      url: 'https://nextjs.org/docs',
      type: 'web',
      discoveredBy: 'direct',
      status: 'valid',
      confidence: 1.0,
      authority: 'official',
      machineReadable: false,
    });

    // Ingest page and create snapshot for v14
    repo.savePage({
      id: 'page_next_v14',
      sourceId: srcId,
      title: 'Next.js 14 App Router',
      url: 'https://nextjs.org/docs/v14',
      content: '# Next.js 14 App Router Guide\nUse app directory for server components.',
      contentHash: 'hash_v14_content',
      fetchedAt: '2026-01-01T00:00:00Z',
      rawBytes: 500,
      estimatedTokens: 100,
      headings: [],
      links: [],
      codeExamples: [],
      securityAnnotations: [],
    });
    repo.createSnapshot(srcId, { docVersion: 'v14' }, 'v14');

    const scan = detectWorkspaceDependencies(tempDir);

    // 1. Initial lock generation
    const lock1 = generateDocsLock(scan, repo);
    writeDocsLock(tempDir, lock1);

    const fileContent1 = readFileSync(join(tempDir, 'docs.lock'), 'utf-8');
    assert.ok(lock1.dependencies['next']);
    assert.strictEqual(lock1.dependencies['next'].docVersion, 'v14');
    assert.strictEqual(lock1.dependencies['next'].matchType, 'major');

    // Artificial delay to verify timestamp preservation
    const originalRetrievedAt = lock1.dependencies['next'].retrievedAt;

    // 2. Repeated lock generation against unchanged dependencies and docs
    const existingLock = readDocsLock(tempDir);
    const lock2 = generateDocsLock(scan, repo, existingLock);
    writeDocsLock(tempDir, lock2);

    const fileContent2 = readFileSync(join(tempDir, 'docs.lock'), 'utf-8');

    // Bit-for-bit file equality across repeated runs (Zero lockfile churn!)
    assert.strictEqual(fileContent1, fileContent2);
    assert.strictEqual(lock2.dependencies['next'].retrievedAt, originalRetrievedAt);

    // 3. Selective update with updateDocsLock
    const lockUpdated = updateDocsLock(scan, repo, lock2, 'next');
    assert.ok(lockUpdated.dependencies['next']);
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('DocsLock: locks dependencies when candidate sources without snapshots exist alongside ingested sources', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'docorbit-multi-source-test-'));
  const dbPath = join(tempDir, 'test.db');
  const db = new DocOrbitDb(dbPath);
  const repo = new DocOrbitRepository(db);

  try {
    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          stripe: '^17.7.0',
        },
      })
    );

    // Save multiple sources discovered during discovery
    repo.saveSource({
      id: 'src_stripe_sitemap',
      url: 'https://docs.stripe.com/sitemap.xml',
      type: 'sitemap',
      discoveredBy: 'sitemap',
      status: 'valid',
      confidence: 0.9,
      authority: 'official',
      machineReadable: true,
    });

    repo.saveSource({
      id: 'src_stripe_llms',
      url: 'https://docs.stripe.com/llms.txt',
      type: 'llms_txt',
      discoveredBy: 'llms_txt',
      status: 'valid',
      confidence: 0.98,
      authority: 'official',
      machineReadable: true,
    });

    const activeSourceId = repo.saveSource({
      url: 'https://docs.stripe.com/api.md',
      type: 'markdown',
      discoveredBy: 'markdown',
      status: 'valid',
      confidence: 0.95,
      authority: 'official',
      machineReadable: true,
    });

    // Only activeSourceId has page and snapshot
    repo.savePage({
      id: 'page_stripe_1',
      sourceId: activeSourceId,
      title: 'Stripe API Reference',
      url: 'https://docs.stripe.com/api',
      content: '# Stripe API Reference\nCharges and Payments API.',
      contentHash: 'hash_stripe_content',
      fetchedAt: '2026-01-01T00:00:00Z',
      rawBytes: 2000,
      estimatedTokens: 300,
      headings: [],
      links: [],
      codeExamples: [],
      securityAnnotations: [],
    });
    const snapshotId = repo.createSnapshot(activeSourceId, { targetUrl: 'https://docs.stripe.com/api', pageCount: 1 });

    const scan = detectWorkspaceDependencies(tempDir);
    const lock = generateDocsLock(scan, repo);

    assert.ok(lock.dependencies['stripe'], 'Expected stripe dependency to be locked');
    assert.strictEqual(lock.dependencies['stripe'].docSourceUrl, 'https://docs.stripe.com/api.md');
    assert.strictEqual(lock.dependencies['stripe'].snapshotId, snapshotId);

    // Verify workspace resolver also matches
    const resolver = new WorkspaceResolver(repo);
    const resolved = resolver.resolveWorkspace(scan);
    assert.strictEqual(resolved.matches.length, 1);
    assert.strictEqual(resolved.matches[0].dependency.name, 'stripe');
    assert.strictEqual(resolved.matches[0].snapshotId, snapshotId);
  } finally {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
