import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  DocsLock,
  LockedSource,
  SourceManagementResult,
  SourceStatus,
} from '../shared/index.ts';
import { canonicalizeSourceUrl } from '../shared/index.ts';
import type { DocOrbitRepository } from '../storage/index.ts';
import {
  readDocsLock,
  writeDocsLock,
  detectWorkspaceDependencies,
  generateDocsLock,
} from '../workspace/index.ts';
import { IngestionPipeline, type IngestionResult } from './pipeline.ts';
import { buildNormalizedPage, slicePageIntoChunks } from '../normalizer/index.ts';

export interface TrackSourceOptions {
  url: string;
  projectDir?: string;
  force?: boolean;
  refresh?: boolean;
  trackOnly?: boolean;
  maxPages?: number;
  allowLocalhost?: boolean;
  content?: string;
  title?: string;
  taskContext?: string;
}

export class SourceManagementService {
  private repo: DocOrbitRepository;
  private defaultProjectDir?: string;

  constructor(repo: DocOrbitRepository, options: { projectDir?: string } = {}) {
    this.repo = repo;
    this.defaultProjectDir = options.projectDir;
  }

  /**
   * Deterministically and idempotently adds or updates a documentation source.
   * Both CLI commands and MCP handlers route through this shared service.
   */
  async addOrTrackSource(options: TrackSourceOptions): Promise<SourceManagementResult> {
    const rawUrl = options.url ? options.url.trim() : '';
    const rawContent = options.content ? options.content.trim() : '';

    if (!rawUrl && !rawContent) {
      throw new Error('Please provide a source URL or content to track.');
    }

    const canonicalUrl = rawUrl ? canonicalizeSourceUrl(rawUrl) : 'local://direct-content';
    const isForce = Boolean(options.force || options.refresh);
    const trackOnly = Boolean(options.trackOnly);
    const projectDir = resolve(options.projectDir || this.defaultProjectDir || process.cwd());

    // 1. Check existing state in docs.lock
    const existingLock = readDocsLock(projectDir);
    const existingTracked = existingLock?.sources?.find(s => s.url === canonicalUrl);

    // 2. Check existing state in SQLite repository
    const existingDbSource = this.repo.getSourceByUrl(canonicalUrl);
    const existingSnapshot = existingDbSource ? this.repo.getLatestSnapshot(existingDbSource.id) : null;

    // 3. Track-only mode (without immediate ingestion)
    if (trackOnly) {
      return this.handleTrackOnly(canonicalUrl, projectDir, existingLock, existingTracked, existingDbSource, options);
    }

    // 4. Direct content mode
    if (rawContent) {
      return this.handleDirectContent(canonicalUrl, rawContent, projectDir, existingLock, existingTracked, options);
    }

    // 5. Normal URL Ingestion: Idempotency check
    // If source is already tracked and has a snapshot, and no explicit force/refresh requested:
    if (existingTracked && existingSnapshot && !isForce) {
      return {
        status: 'already_tracked',
        url: canonicalUrl,
        sourceId: existingTracked.sourceId,
        snapshotId: existingTracked.snapshotId,
        snapshotHash: existingTracked.snapshotHash,
        pageCount: existingTracked.pageCount,
        docVersion: existingTracked.docVersion,
        trackedAt: existingTracked.trackedAt,
        updatedAt: existingTracked.updatedAt,
        message: `Source is already tracked and up to date: ${canonicalUrl}`,
      };
    }

    // 6. Ingest or refresh source via existing IngestionPipeline
    const pipeline = new IngestionPipeline(this.repo, {
      allowLocalhostForTesting: options.allowLocalhost,
      crawlerConfig: {
        maxPages: options.maxPages || 50,
      },
    });

    const result = await pipeline.ingest(canonicalUrl);
    const snapshotRecord = this.repo.getSnapshot(result.snapshotId);
    const snapshotHash = snapshotRecord?.snapshotHash || '';

    // 7. Detect whether content changed vs unchanged
    let status: SourceStatus = 'added';
    if (existingTracked || existingSnapshot) {
      if (existingSnapshot && existingSnapshot.snapshotHash === snapshotHash && !isForce) {
        status = 'already_tracked';
      } else {
        status = 'updated';
      }
    }

    const now = new Date().toISOString();
    const lockedSource: LockedSource = {
      url: canonicalUrl,
      sourceId: result.primarySourceId,
      status: 'ingested',
      title: result.pages[0]?.title || undefined,
      snapshotId: result.snapshotId,
      snapshotHash,
      docVersion: result.pages[0]?.docVersion || undefined,
      pageCount: result.stats.totalPages,
      trackedAt: existingTracked?.trackedAt || now,
      updatedAt: now,
    };

    // 8. Synchronize docs.lock
    this.syncDocsLock(projectDir, lockedSource, existingLock);

    const message = status === 'already_tracked'
      ? `Source is already tracked and unchanged: ${canonicalUrl}`
      : status === 'updated'
        ? `Updated tracked source: ${canonicalUrl} (Snapshot: ${result.snapshotId})`
        : `Added and tracked new source: ${canonicalUrl} (Snapshot: ${result.snapshotId})`;

    return {
      status,
      url: canonicalUrl,
      sourceId: result.primarySourceId,
      snapshotId: result.snapshotId,
      snapshotHash,
      pageCount: result.stats.totalPages,
      docVersion: result.pages[0]?.docVersion,
      trackedAt: lockedSource.trackedAt,
      updatedAt: lockedSource.updatedAt,
      message,
      ingestionResult: result,
    };
  }

  private handleTrackOnly(
    canonicalUrl: string,
    projectDir: string,
    existingLock: DocsLock | null,
    existingTracked: LockedSource | undefined,
    existingDbSource: { id: string } | null,
    options: TrackSourceOptions
  ): SourceManagementResult {
    const sourceId = existingDbSource?.id || this.repo.saveSource({
      url: canonicalUrl,
      type: 'web',
      discoveredBy: 'manual',
      status: 'valid',
      confidence: 1.0,
      authority: 'official',
      machineReadable: false,
    });

    const now = new Date().toISOString();
    if (existingTracked && !options.force && !options.refresh) {
      return {
        status: 'already_tracked',
        url: canonicalUrl,
        sourceId: existingTracked.sourceId,
        snapshotId: existingTracked.snapshotId,
        snapshotHash: existingTracked.snapshotHash,
        pageCount: existingTracked.pageCount,
        docVersion: existingTracked.docVersion,
        trackedAt: existingTracked.trackedAt,
        updatedAt: existingTracked.updatedAt,
        message: `Source is already tracked: ${canonicalUrl}`,
      };
    }

    const lockedSource: LockedSource = {
      url: canonicalUrl,
      sourceId,
      status: 'tracked',
      title: options.title,
      trackedAt: existingTracked?.trackedAt || now,
      updatedAt: now,
    };

    this.syncDocsLock(projectDir, lockedSource, existingLock);

    return {
      status: existingTracked ? 'updated' : 'added',
      url: canonicalUrl,
      sourceId,
      trackedAt: lockedSource.trackedAt,
      updatedAt: lockedSource.updatedAt,
      message: `Tracked source: ${canonicalUrl}`,
    };
  }

  private handleDirectContent(
    canonicalUrl: string,
    rawContent: string,
    projectDir: string,
    existingLock: DocsLock | null,
    existingTracked: LockedSource | undefined,
    options: TrackSourceOptions
  ): SourceManagementResult {
    const sourceId = this.repo.saveSource({
      url: canonicalUrl,
      type: 'web',
      discoveredBy: 'direct',
      status: 'valid',
      confidence: 1.0,
      authority: 'official',
      machineReadable: false,
    });

    const now = new Date().toISOString();
    const page = buildNormalizedPage({
      sourceId,
      url: canonicalUrl,
      rawContent,
      contentType: 'text/markdown',
      sourceUrl: canonicalUrl,
      targetUrl: canonicalUrl,
      title: options.title || 'Direct Content Ingestion',
      discoveredBy: 'direct',
      fetchedAt: now,
    });

    this.repo.savePage(page);

    const snapshotId = this.repo.createSnapshot(sourceId, {
      targetUrl: canonicalUrl,
      pageCount: 1,
      ingestedAt: now,
    });

    const slicing = slicePageIntoChunks(page, snapshotId);
    this.repo.saveChunks(slicing.chunks, slicing.relationships, slicing.codeSnippets, slicing.symbols);

    const snapshotRecord = this.repo.getSnapshot(snapshotId);
    const snapshotHash = snapshotRecord?.snapshotHash || '';

    const status: SourceStatus = existingTracked ? 'updated' : 'added';

    const lockedSource: LockedSource = {
      url: canonicalUrl,
      sourceId,
      status: 'ingested',
      title: page.title,
      snapshotId,
      snapshotHash,
      pageCount: 1,
      trackedAt: existingTracked?.trackedAt || now,
      updatedAt: now,
    };

    this.syncDocsLock(projectDir, lockedSource, existingLock);

    const ingestionResult: Partial<IngestionResult> = {
      targetUrl: canonicalUrl,
      primarySourceId: sourceId,
      sourcesDiscovered: [],
      selectedSources: [],
      pages: [page],
      pagesDiscovered: 1,
      pagesFetched: 1,
      pagesStored: 1,
      snapshotId,
      warnings: [],
      errors: [],
      durationMs: 0,
      stats: {
        totalPages: 1,
        totalBytes: Buffer.byteLength(rawContent, 'utf-8'),
        totalEstimatedTokens: page.estimatedTokens,
        totalCodeExamples: page.codeExamples.length,
        machineReadableSources: 0,
        totalChunks: slicing.chunks.length,
      },
    };

    return {
      status,
      url: canonicalUrl,
      sourceId,
      snapshotId,
      snapshotHash,
      pageCount: 1,
      trackedAt: lockedSource.trackedAt,
      updatedAt: now,
      message: `${status === 'updated' ? 'Updated' : 'Added'} direct content source: ${canonicalUrl}`,
      ingestionResult,
    };
  }

  private syncDocsLock(
    projectDir: string,
    lockedSource: LockedSource,
    existingLock: DocsLock | null
  ): void {
    try {
      // 1. Prepare base lock
      let lock: DocsLock;
      if (existingLock) {
        lock = {
          ...existingLock,
          dependencies: { ...existingLock.dependencies },
          sources: [...(existingLock.sources || [])],
        };
      } else {
        lock = {
          version: 1,
          workspaceRoot: projectDir,
          dependencies: {},
          sources: [],
        };
      }

      // 2. Add or update source entry
      const sources = lock.sources || [];
      const idx = sources.findIndex(s => s.url === lockedSource.url);
      if (idx >= 0) {
        sources[idx] = lockedSource;
      } else {
        sources.push(lockedSource);
      }
      lock.sources = sources;

      // 3. If workspace has manifest dependencies, also reconcile dependencies
      const scanResult = detectWorkspaceDependencies(projectDir);
      if (scanResult.dependencies.length > 0) {
        const generated = generateDocsLock(scanResult, this.repo, lock);
        lock.dependencies = generated.dependencies;
      }

      writeDocsLock(projectDir, lock);
    } catch {
      // Non-critical: lockfile writing should not crash ingestion pipeline
    }
  }
}

export { SourceManagementService as SourceManager };
