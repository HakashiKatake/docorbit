import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import type {
  DocOrbitRepository,
} from '../../../storage/src/index.ts';
import { ExportService } from '../../../export/src/index.ts';
import {
  VerificationService,
  DiffService,
  ImpactAnalysisService,
} from '../../../verification/src/index.ts';
import type {
  DashboardStats,
  ExportFormat,
  PitfallKind,
} from '../../../shared/src/index.ts';
import { renderDashboardHtml } from './ui.ts';

export interface DashboardServerOptions {
  repo: DocOrbitRepository;
  projectDir?: string;
  dbPath?: string;
}

export class DashboardServer {
  private repo: DocOrbitRepository;
  private projectDir?: string;
  private dbPath: string;
  private exportService: ExportService;
  private verificationService: VerificationService;
  private diffService: DiffService;
  private impactService: ImpactAnalysisService;
  private server: http.Server | null = null;

  constructor(options: DashboardServerOptions) {
    this.repo = options.repo;
    this.projectDir = options.projectDir;
    this.dbPath = options.dbPath || '.docorbit/docorbit.db';
    this.exportService = new ExportService(this.repo);
    this.verificationService = new VerificationService(this.repo);
    this.diffService = new DiffService(this.repo);
    this.impactService = new ImpactAnalysisService(this.repo);
  }

  /**
   * Starts the local dashboard HTTP server.
   */
  start(port = 3737, host = '127.0.0.1'): Promise<{ server: http.Server; url: string; port: number }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
        }
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(port, host, () => {
        const address = this.server!.address() as { port: number; address: string };
        const actualPort = address.port;
        const url = `http://${host}:${actualPort}/`;
        resolve({ server: this.server!, url, port: actualPort });
      });
    });
  }

  /**
   * Stops the server gracefully.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Resolves a static site file across local development and distributed package locations.
   */
  private resolveSiteFile(relPath: string): string | null {
    try {
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      const candidates = [
        path.resolve(this.projectDir || process.cwd(), relPath),
        path.resolve(moduleDir, '../../../../', relPath),
        path.resolve(moduleDir, '../../../../../', relPath),
        path.resolve(moduleDir, '../../../', relPath),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    } catch {
      const fallback = path.resolve(this.projectDir || process.cwd(), relPath);
      if (fs.existsSync(fallback)) return fallback;
    }
    return null;
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    // CORS for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Root UI
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderDashboardHtml());
      return;
    }

    // Static Landing Page
    if (pathname === '/site' || pathname === '/site/' || pathname === '/site/index.html') {
      const siteHtmlPath = this.resolveSiteFile('site/index.html');
      if (siteHtmlPath) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(siteHtmlPath, 'utf-8'));
        return;
      }
    }

    // Static Documentation Page (/docs)
    if (pathname === '/docs' || pathname === '/docs/' || pathname === '/docs.html' || pathname === '/site/docs' || pathname === '/site/docs/' || pathname === '/site/docs.html') {
      const docsHtmlPath = this.resolveSiteFile('site/docs/index.html') || this.resolveSiteFile('site/docs.html');
      if (docsHtmlPath) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(docsHtmlPath, 'utf-8'));
        return;
      }
    }

    if (pathname === '/site/styles.css' || pathname === '/docs/styles.css' || (pathname === '/styles.css' && (req.headers.referer?.includes('/site') || req.headers.referer?.includes('/docs')))) {
      const cssPath = this.resolveSiteFile('site/styles.css');
      if (cssPath) {
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        res.end(fs.readFileSync(cssPath, 'utf-8'));
        return;
      }
    }

    if (pathname === '/site/app.js' || pathname === '/docs/app.js' || (pathname === '/app.js' && (req.headers.referer?.includes('/site') || req.headers.referer?.includes('/docs')))) {
      const jsPath = this.resolveSiteFile('site/app.js');
      if (jsPath) {
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(fs.readFileSync(jsPath, 'utf-8'));
        return;
      }
    }

    // JSON REST API
    if (pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');

      if (pathname === '/api/stats' && method === 'GET') {
        const stats = this.getStats();
        res.writeHead(200);
        res.end(JSON.stringify(stats));
        return;
      }

      if (pathname === '/api/sources' && method === 'GET') {
        const sources = this.repo.sources.listSources();
        res.writeHead(200);
        res.end(JSON.stringify(sources));
        return;
      }

      if (pathname === '/api/pages' && method === 'GET') {
        const pages = this.repo.pages.listPages(200);
        res.writeHead(200);
        res.end(JSON.stringify(pages));
        return;
      }

      if (pathname === '/api/tree' && method === 'GET') {
        const sourceId = parsedUrl.searchParams.get('sourceId') || undefined;
        const tree = this.repo.getDocumentTree(sourceId);
        res.writeHead(200);
        res.end(JSON.stringify(tree));
        return;
      }

      if (pathname === '/api/apis' && method === 'GET') {
        const q = parsedUrl.searchParams.get('q') || '';
        const apiMethod = parsedUrl.searchParams.get('method') || undefined;
        const docVersion = parsedUrl.searchParams.get('docVersion') || undefined;
        const apis = this.repo.apis.searchApiEndpoints(q, {
          method: apiMethod,
          docVersion,
          limit: 100,
        });
        res.writeHead(200);
        res.end(JSON.stringify(apis));
        return;
      }

      if (pathname === '/api/pitfalls' && method === 'GET') {
        const q = parsedUrl.searchParams.get('q') || '';
        const kind = (parsedUrl.searchParams.get('kind') as PitfallKind) || undefined;
        const docVersion = parsedUrl.searchParams.get('docVersion') || undefined;
        const pitfalls = this.repo.pitfalls.searchPitfalls(q, {
          kind,
          docVersion,
          limit: 100,
        });
        res.writeHead(200);
        res.end(JSON.stringify(pitfalls));
        return;
      }

      if (pathname === '/api/examples' && method === 'GET') {
        const q = parsedUrl.searchParams.get('q') || '';
        const language = parsedUrl.searchParams.get('language') || undefined;
        const framework = parsedUrl.searchParams.get('framework') || undefined;
        const docVersion = parsedUrl.searchParams.get('docVersion') || undefined;
        const examples = this.repo.examples.searchIndexedExamples(q, {
          language,
          framework,
          docVersion,
          limit: 50,
        });
        res.writeHead(200);
        res.end(JSON.stringify(examples));
        return;
      }

      if (pathname === '/api/docs-map' && method === 'GET') {
        const sourceId = parsedUrl.searchParams.get('sourceId') || undefined;
        const docVersion = parsedUrl.searchParams.get('docVersion') || undefined;
        const map = this.exportService.getDocumentationMap({ sourceId, docVersion });
        res.writeHead(200);
        res.end(JSON.stringify(map));
        return;
      }

      if (pathname === '/api/export' && method === 'GET') {
        const format = (parsedUrl.searchParams.get('format') || 'agents.md') as ExportFormat;
        const docVersion = parsedUrl.searchParams.get('docVersion') || undefined;
        const exp = await this.exportService.generateExport({
          format,
          docVersion,
          projectDir: this.projectDir,
        });
        res.writeHead(200);
        res.end(JSON.stringify(exp));
        return;
      }

      if (pathname === '/api/verify' && method === 'POST') {
        const body = await this.readJsonBody(req);
        const code = body.code || '';
        const version = body.version || body.docVersion;
        const library = body.library;
        const language = body.language;

        const verifyResult = this.verificationService.verifyCode({
          code,
          version,
          library,
          language,
          projectDir: this.projectDir,
        });

        res.writeHead(200);
        res.end(JSON.stringify(verifyResult));
        return;
      }

      if (pathname === '/api/diff' && method === 'GET') {
        const from = parsedUrl.searchParams.get('from') || undefined;
        const to = parsedUrl.searchParams.get('to') || undefined;
        const source = parsedUrl.searchParams.get('source') || undefined;
        const diffResult = this.diffService.diff({ from, to, source });
        res.writeHead(200);
        res.end(JSON.stringify(diffResult));
        return;
      }

      if (pathname === '/api/impact' && method === 'GET') {
        const from = parsedUrl.searchParams.get('from') || undefined;
        const to = parsedUrl.searchParams.get('to') || undefined;
        const targetDir = parsedUrl.searchParams.get('projectDir') || this.projectDir || process.cwd();
        const impactResult = this.impactService.analyzeWorkspaceImpact({
          from,
          to,
          projectDir: targetDir,
        });
        res.writeHead(200);
        res.end(JSON.stringify(impactResult));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: `Route not found: ${pathname}` }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private getStats(): DashboardStats {
    const sources = this.repo.sources.listSources();
    const totalPages = this.repo.pages.countPages();
    const totalChunks = this.repo.chunks.countChunks();

    let totalApis = 0;
    let totalPitfalls = 0;
    let totalExamples = 0;
    const activeVersions = new Set<string>();

    try {
      const raw = this.repo.db.getRawDb();
      const apiRow = raw.prepare('SELECT COUNT(*) as c FROM api_endpoints').get() as { c: number } | undefined;
      totalApis = apiRow?.c || 0;

      const pitRow = raw.prepare('SELECT COUNT(*) as c FROM pitfalls').get() as { c: number } | undefined;
      totalPitfalls = pitRow?.c || 0;

      const exRow = raw.prepare('SELECT COUNT(*) as c FROM indexed_examples').get() as { c: number } | undefined;
      totalExamples = exRow?.c || 0;

      const verRows = raw.prepare('SELECT DISTINCT doc_version FROM snapshots WHERE doc_version IS NOT NULL').all() as Array<{ doc_version: string }>;
      for (const r of verRows) {
        if (r.doc_version) activeVersions.add(r.doc_version);
      }
    } catch {
      // Best-effort stats aggregation
    }

    return {
      totalSources: sources.length,
      totalPages,
      totalChunks,
      totalApis,
      totalPitfalls,
      totalExamples,
      totalRecipes: 5,
      activeVersions: Array.from(activeVersions).sort(),
      dbPath: this.dbPath,
      untrusted: true,
    };
  }

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', (err) => reject(err));
    });
  }
}
