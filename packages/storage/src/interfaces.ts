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
  DocumentationTreeNode,
} from '../../shared/src/index.ts';

export interface Snapshot {
  id: string;
  sourceId: string;
  hash: string;
  pageCount: number;
  docVersion?: string;
  createdAt: string;
}

export interface ISourceRepository {
  saveSource(source: DiscoveredSource): string;
  getSource(id: string): DiscoveredSource | null;
  getSourceByUrl(url: string): DiscoveredSource | null;
  listSources(): DiscoveredSource[];
  createSnapshot(sourceId: string, metadata?: Record<string, unknown>, docVersion?: string): string;
  saveSnapshot(snapshot: Snapshot): void;
  getSnapshot(id: string): Snapshot | null;
  getLatestSnapshot(sourceId: string): Snapshot | null;
  listSnapshots(sourceId: string): Snapshot[];
  linkSnapshotPages(snapshotId: string, pageIds: string[]): void;
  getSnapshotPages(snapshotId: string): NormalizedPage[];
}

export interface IPageRepository {
  savePage(page: NormalizedPage): void;
  getPage(id: string): NormalizedPage | null;
  getPageByUrl(normalizedUrl: string): NormalizedPage | null;
  listPages(limit?: number, offset?: number): NormalizedPage[];
  countPages(sourceId?: string): number;
  savePageLinks(pageId: string, targetUrls: string[]): void;
  getPageLinks(pageId: string): string[];
  searchPagesFts(query: string, limit?: number): NormalizedPage[];
  getDocumentTree(sourceId?: string): DocumentationTreeNode | null;
}

export interface IChunkRepository {
  saveChunks(
    chunks: DocumentChunk[],
    relationships?: ChunkRelationship[],
    codeSnippets?: ChunkCode[],
    symbols?: SymbolReference[]
  ): void;
  getChunk(id: string): DocumentChunk | null;
  getChunksByPage(pageId: string): DocumentChunk[];
  getChunksBySnapshot(snapshotId: string): DocumentChunk[];
  getChunksByVersion(docVersion: string): DocumentChunk[];
  getChunkCode(chunkId: string): ChunkCode[];
  getChunkSymbols(chunkId: string): SymbolReference[];
  getChunkRelationships(chunkId: string): ChunkRelationship[];
  countChunks(snapshotId?: string): number;
  searchChunksFts(
    query: string,
    options?: {
      limit?: number;
      snapshotId?: string;
      chunkType?: ChunkType;
      docVersion?: string;
    }
  ): Array<{
    chunk: DocumentChunk;
    ftsRank: number;
    sourceAuthority?: SourceAuthority;
    symbols: SymbolReference[];
    codeSnippets: ChunkCode[];
  }>;
}

export interface IApiRepository {
  saveApiEndpoints(endpoints: ApiEndpoint[]): void;
  getApiEndpoint(id: string): ApiEndpoint | null;
  getApiEndpointsBySnapshot(snapshotId: string): ApiEndpoint[];
  searchApiEndpoints(
    query: string,
    options?: { method?: string; docVersion?: string; limit?: number }
  ): ApiEndpoint[];
}

export interface IExampleRepository {
  saveIndexedExamples(examples: IndexedExample[]): void;
  getIndexedExamplesBySnapshot(snapshotId: string): IndexedExample[];
  searchIndexedExamples(
    query: string,
    options?: {
      language?: string;
      framework?: string;
      docVersion?: string;
      limit?: number;
    }
  ): IndexedExample[];
}

export interface IPitfallRepository {
  savePitfalls(pitfalls: Pitfall[]): void;
  getPitfallsBySnapshot(snapshotId: string): Pitfall[];
  searchPitfalls(
    query: string,
    options?: {
      kind?: PitfallKind;
      docVersion?: string;
      limit?: number;
    }
  ): Pitfall[];
}
