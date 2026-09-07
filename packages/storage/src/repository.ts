import type {
  DiscoveredSource,
  NormalizedPage,
  DocumentChunk,
  ChunkCode,
  SymbolReference,
  ChunkRelationship,
  ChunkType,
  ApiEndpoint,
  IndexedExample,
  Pitfall,
  PitfallKind,
} from '../../shared/src/index.ts';
import type { DocOrbitDb } from './db.ts';
import type {
  Snapshot,
  ISourceRepository,
  IPageRepository,
  IChunkRepository,
  IApiRepository,
  IExampleRepository,
  IPitfallRepository,
} from './interfaces.ts';
import { SourceRepository } from './repositories/source-repository.ts';
import { PageRepository } from './repositories/page-repository.ts';
import { ChunkRepository } from './repositories/chunk-repository.ts';
import { ApiRepository } from './repositories/api-repository.ts';
import { ExampleRepository } from './repositories/example-repository.ts';
import { PitfallRepository } from './repositories/pitfall-repository.ts';

export type { Snapshot } from './interfaces.ts';

/**
 * Unified Facade for the DocOrbit database storage layer.
 * Delegates domain responsibilities to specialized sub-repositories:
 * - sources: ISourceRepository (sources, snapshots, snapshot-page links)
 * - pages: IPageRepository (normalized pages, page links, page FTS)
 * - chunks: IChunkRepository (document chunks, code, symbols, relationships, chunk FTS)
 * - apis: IApiRepository (API endpoints, OpenAPI schemas, endpoint FTS)
 * - examples: IExampleRepository (code examples, example FTS)
 * - pitfalls: IPitfallRepository (pitfalls, gotchas, pitfall FTS)
 */
export class DocOrbitRepository
  implements
    ISourceRepository,
    IPageRepository,
    IChunkRepository,
    IApiRepository,
    IExampleRepository,
    IPitfallRepository
{
  public readonly sources: SourceRepository;
  public readonly pages: PageRepository;
  public readonly chunks: ChunkRepository;
  public readonly apis: ApiRepository;
  public readonly examples: ExampleRepository;
  public readonly pitfalls: PitfallRepository;

  public readonly db: DocOrbitDb;

  constructor(db: DocOrbitDb) {
    this.db = db;
    this.pages = new PageRepository(db);
    this.sources = new SourceRepository(db, row => this.pages.hydratePage(row));
    this.chunks = new ChunkRepository(db);
    this.apis = new ApiRepository(db);
    this.examples = new ExampleRepository(db);
    this.pitfalls = new PitfallRepository(db);
  }

  // --- ISourceRepository Delegations ---

  saveSource(source: DiscoveredSource): string {
    return this.sources.saveSource(source);
  }

  getSource(id: string): DiscoveredSource | null {
    return this.sources.getSource(id);
  }

  getSourceByUrl(url: string): DiscoveredSource | null {
    return this.sources.getSourceByUrl(url);
  }

  listSources(): DiscoveredSource[] {
    return this.sources.listSources();
  }

  createSnapshot(sourceId: string, metadata?: Record<string, unknown>, docVersion?: string): string {
    return this.sources.createSnapshot(sourceId, metadata, docVersion);
  }

  saveSnapshot(snapshot: Snapshot): void {
    this.sources.saveSnapshot(snapshot);
  }

  getSnapshot(id: string): Snapshot | null {
    return this.sources.getSnapshot(id);
  }

  getLatestSnapshot(sourceId: string): Snapshot | null {
    return this.sources.getLatestSnapshot(sourceId);
  }

  listSnapshots(sourceId: string): Snapshot[] {
    return this.sources.listSnapshots(sourceId);
  }

  linkSnapshotPages(snapshotId: string, pageIds: string[]): void {
    this.sources.linkSnapshotPages(snapshotId, pageIds);
  }

  getSnapshotPages(snapshotId: string): NormalizedPage[] {
    return this.sources.getSnapshotPages(snapshotId);
  }

  // --- IPageRepository Delegations ---

  savePage(page: NormalizedPage): void {
    this.pages.savePage(page);
  }

  getPage(id: string): NormalizedPage | null {
    return this.pages.getPage(id);
  }

  getPageByUrl(normalizedUrl: string): NormalizedPage | null {
    return this.pages.getPageByUrl(normalizedUrl);
  }

  listPages(limit?: number, offset?: number): NormalizedPage[] {
    return this.pages.listPages(limit, offset);
  }

  countPages(sourceId?: string): number {
    return this.pages.countPages(sourceId);
  }

  savePageLinks(pageId: string, targetUrls: string[]): void {
    this.pages.savePageLinks(pageId, targetUrls);
  }

  getPageLinks(pageId: string): string[] {
    return this.pages.getPageLinks(pageId);
  }

  searchPagesFts(query: string, limit: number = 10): NormalizedPage[] {
    return this.pages.searchPagesFts(query, limit);
  }

  // --- IChunkRepository Delegations ---

  saveChunks(
    chunks: DocumentChunk[],
    relationships: ChunkRelationship[] = [],
    codeSnippets: ChunkCode[] = [],
    symbols: SymbolReference[] = []
  ): void {
    this.chunks.saveChunks(chunks, relationships, codeSnippets, symbols);
  }

  getChunk(id: string): DocumentChunk | null {
    return this.chunks.getChunk(id);
  }

  getChunksByPage(pageId: string): DocumentChunk[] {
    return this.chunks.getChunksByPage(pageId);
  }

  getChunksBySnapshot(snapshotId: string): DocumentChunk[] {
    return this.chunks.getChunksBySnapshot(snapshotId);
  }

  getChunksByVersion(docVersion: string): DocumentChunk[] {
    return this.chunks.getChunksByVersion(docVersion);
  }

  getChunkCode(chunkId: string): ChunkCode[] {
    return this.chunks.getChunkCode(chunkId);
  }

  getChunkSymbols(chunkId: string): SymbolReference[] {
    return this.chunks.getChunkSymbols(chunkId);
  }

  getChunkRelationships(chunkId: string): ChunkRelationship[] {
    return this.chunks.getChunkRelationships(chunkId);
  }

  countChunks(snapshotId?: string): number {
    return this.chunks.countChunks(snapshotId);
  }

  searchChunksFts(
    query: string,
    options: { limit?: number; snapshotId?: string; chunkType?: ChunkType; docVersion?: string } = {}
  ): Array<{ chunk: DocumentChunk; ftsRank: number; symbols: SymbolReference[]; codeSnippets: ChunkCode[] }> {
    return this.chunks.searchChunksFts(query, options);
  }

  // --- IApiRepository Delegations ---

  saveApiEndpoints(endpoints: ApiEndpoint[]): void {
    this.apis.saveApiEndpoints(endpoints);
  }

  getApiEndpoint(id: string): ApiEndpoint | null {
    return this.apis.getApiEndpoint(id);
  }

  getApiEndpointsBySnapshot(snapshotId: string): ApiEndpoint[] {
    return this.apis.getApiEndpointsBySnapshot(snapshotId);
  }

  searchApiEndpoints(
    query: string,
    options: { method?: string; docVersion?: string; limit?: number } = {}
  ): ApiEndpoint[] {
    return this.apis.searchApiEndpoints(query, options);
  }

  // --- IExampleRepository Delegations ---

  saveIndexedExamples(examples: IndexedExample[]): void {
    this.examples.saveIndexedExamples(examples);
  }

  getIndexedExamplesBySnapshot(snapshotId: string): IndexedExample[] {
    return this.examples.getIndexedExamplesBySnapshot(snapshotId);
  }

  searchIndexedExamples(
    query: string,
    options: { language?: string; framework?: string; docVersion?: string; limit?: number } = {}
  ): IndexedExample[] {
    return this.examples.searchIndexedExamples(query, options);
  }

  // --- IPitfallRepository Delegations ---

  savePitfalls(pitfalls: Pitfall[]): void {
    this.pitfalls.savePitfalls(pitfalls);
  }

  getPitfallsBySnapshot(snapshotId: string): Pitfall[] {
    return this.pitfalls.getPitfallsBySnapshot(snapshotId);
  }

  searchPitfalls(
    query: string,
    options: { kind?: PitfallKind; docVersion?: string; limit?: number } = {}
  ): Pitfall[] {
    return this.pitfalls.searchPitfalls(query, options);
  }
}

