/**
 * Embedded HTML/CSS/JS dashboard UI for DocOrbit.
 * Lightweight, zero external dependencies, zero CDN requests, fully offline capable.
 */
export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DocOrbit — Documentation Intelligence Dashboard</title>
  <style>
    :root {
      --bg: #0f172a;
      --surface: #1e293b;
      --surface-hover: #334155;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --accent: #06b6d4;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0.75rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .brand-icon {
      width: 2rem;
      height: 2rem;
      background: linear-gradient(135deg, var(--primary), var(--accent));
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      color: #fff;
    }
    .brand-title {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .badge {
      font-size: 0.75rem;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-primary { background: rgba(99, 102, 241, 0.2); color: var(--primary); border: 1px solid var(--primary); }
    .badge-success { background: rgba(16, 185, 129, 0.2); color: var(--success); border: 1px solid var(--success); }
    .badge-warning { background: rgba(245, 158, 11, 0.2); color: var(--warning); border: 1px solid var(--warning); }
    .badge-danger { background: rgba(239, 68, 68, 0.2); color: var(--danger); border: 1px solid var(--danger); }
    .badge-untrusted { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid #d97706; }

    nav.tabs {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      padding: 0 1.5rem;
      gap: 0.5rem;
    }
    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      padding: 0.75rem 1rem;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.15s ease;
    }
    .tab-btn:hover { color: var(--text); }
    .tab-btn.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
      font-weight: 600;
    }

    main {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem;
      max-width: 1400px;
      margin: 0 auto;
      width: 100%;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
    }
    .stat-label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .stat-val { font-size: 1.75rem; font-weight: 700; color: var(--text); margin-top: 0.25rem; }

    .search-bar {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    input, select, textarea {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.9rem;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent);
    }
    .btn {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--primary-hover); }
    .btn-secondary {
      background: var(--surface-hover);
      color: var(--text);
    }
    .btn-secondary:hover { background: var(--border); }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
    }
    th, td {
      text-align: left;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
    }
    th { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; background: rgba(0,0,0,0.1); }
    tr:hover { background: var(--surface-hover); }
    code, pre { font-family: var(--font-mono); }
    pre {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 1rem;
      overflow-x: auto;
      font-size: 0.85rem;
    }

    .method-pill {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      text-transform: uppercase;
      display: inline-block;
    }
    .method-get { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .method-post { background: rgba(99, 102, 241, 0.2); color: #818cf8; }
    .method-put { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .method-delete { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .method-patch { background: rgba(236, 72, 153, 0.2); color: #f472b6; }

    .untrusted-banner {
      background: rgba(245, 158, 11, 0.1);
      border-left: 4px solid var(--warning);
      padding: 0.75rem 1rem;
      border-radius: 4px;
      font-size: 0.85rem;
      color: #fde68a;
      margin-bottom: 1.5rem;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">DO</div>
      <div>
        <div class="brand-title">DocOrbit Dashboard</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">Documentation Intelligence & Verification Layer</div>
      </div>
    </div>
    <div style="display: flex; gap: 0.5rem; align-items: center;">
      <a href="/site" target="_blank" class="badge badge-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 0.3rem;">Landing Page ↗</a>
      <span class="badge badge-untrusted">Untrusted Docs Boundary</span>
      <span id="conn-badge" class="badge badge-success">Connected</span>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab-btn active" onclick="switchTab('overview')">Overview</button>
    <button class="tab-btn" onclick="switchTab('apis')">API Explorer</button>
    <button class="tab-btn" onclick="switchTab('pitfalls')">Pitfalls & Caveats</button>
    <button class="tab-btn" onclick="switchTab('examples')">Code Examples</button>
    <button class="tab-btn" onclick="switchTab('docsmap')">Docs Map</button>
    <button class="tab-btn" onclick="switchTab('verifier')">Live Verifier</button>
    <button class="tab-btn" onclick="switchTab('export')">Export Center</button>
  </nav>

  <main>
    <div class="untrusted-banner">
      <strong>Notice:</strong> All indexed external documentation is treated strictly as untrusted input (<code>untrusted: true</code>).
      Extracted API schemas, caveats, and recipes are deterministically verified without autonomous code execution.
    </div>

    <!-- OVERVIEW TAB -->
    <section id="tab-overview" class="tab-content active">
      <div class="grid-stats">
        <div class="card"><div class="stat-label">Sources</div><div id="stat-sources" class="stat-val">0</div></div>
        <div class="card"><div class="stat-label">Pages</div><div id="stat-pages" class="stat-val">0</div></div>
        <div class="card"><div class="stat-label">Chunks</div><div id="stat-chunks" class="stat-val">0</div></div>
        <div class="card"><div class="stat-label">APIs Indexed</div><div id="stat-apis" class="stat-val">0</div></div>
        <div class="card"><div class="stat-label">Pitfalls</div><div id="stat-pitfalls" class="stat-val">0</div></div>
        <div class="card"><div class="stat-label">Examples</div><div id="stat-examples" class="stat-val">0</div></div>
      </div>

      <div class="card" style="margin-bottom: 1.5rem;">
        <h3 style="margin-bottom: 0.75rem;">Indexed Sources & Snapshots</h3>
        <div id="sources-list" style="font-size: 0.9rem; color: var(--text-muted);">Loading sources...</div>
      </div>

      <div class="card">
        <h3 style="margin-bottom: 0.75rem;">Active Documentation Versions</h3>
        <div id="versions-list" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">Loading versions...</div>
      </div>
    </section>

    <!-- APIS TAB -->
    <section id="tab-apis" class="tab-content">
      <div class="search-bar">
        <input type="text" id="api-search" placeholder="Search API path, summary, or parameter..." style="flex: 1;" oninput="loadApis()">
        <select id="api-method" onchange="loadApis()">
          <option value="">All Methods</option>
          <option value="get">GET</option>
          <option value="post">POST</option>
          <option value="put">PUT</option>
          <option value="delete">DELETE</option>
          <option value="patch">PATCH</option>
        </select>
        <input type="text" id="api-version" placeholder="Version (e.g. v14)" style="width: 140px;" oninput="loadApis()">
      </div>
      <div class="card">
        <table id="apis-table">
          <thead>
            <tr><th>Method</th><th>Path</th><th>Summary</th><th>Required Parameters</th><th>Version</th></tr>
          </thead>
          <tbody id="apis-body"><tr><td colspan="5" style="text-align:center;">Loading APIs...</td></tr></tbody>
        </table>
      </div>
    </section>

    <!-- PITFALLS TAB -->
    <section id="tab-pitfalls" class="tab-content">
      <div class="search-bar">
        <input type="text" id="pitfall-search" placeholder="Search warnings, caveats, breaking changes..." style="flex: 1;" oninput="loadPitfalls()">
        <select id="pitfall-kind" onchange="loadPitfalls()">
          <option value="">All Kinds</option>
          <option value="deprecated">Deprecated</option>
          <option value="removed">Removed</option>
          <option value="breaking_change">Breaking Change</option>
          <option value="server_only">Server Only</option>
          <option value="rate_limit">Rate Limit</option>
          <option value="security">Security</option>
        </select>
      </div>
      <div id="pitfalls-list" style="display: flex; flex-direction: column; gap: 1rem;">Loading pitfalls...</div>
    </section>

    <!-- EXAMPLES TAB -->
    <section id="tab-examples" class="tab-content">
      <div class="search-bar">
        <input type="text" id="example-search" placeholder="Search code examples..." style="flex: 1;" oninput="loadExamples()">
        <input type="text" id="example-framework" placeholder="Framework (e.g. next, express)" oninput="loadExamples()">
      </div>
      <div id="examples-list" style="display: flex; flex-direction: column; gap: 1rem;">Loading code examples...</div>
    </section>

    <!-- DOCS MAP TAB -->
    <section id="tab-docsmap" class="tab-content">
      <div class="card">
        <h3 style="margin-bottom: 0.5rem;">Documentation Hierarchy & Token Footprint</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
          Shows the full tree of indexed pages, chunk density, headings, and token allocation estimates.
        </p>
        <pre id="docsmap-content">Loading documentation map...</pre>
      </div>
    </section>

    <!-- LIVE VERIFIER TAB -->
    <section id="tab-verifier" class="tab-content">
      <div class="card" style="margin-bottom: 1.5rem;">
        <h3 style="margin-bottom: 0.5rem;">Interactive API Verification</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
          Test code against indexed OpenAPI schemas, parameters, and version caveats.
        </p>
        <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
          <input type="text" id="verify-version" placeholder="Doc Version (e.g. v14, v15)" style="width: 200px;">
          <button class="btn" onclick="runVerify()">Check Code</button>
        </div>
        <textarea id="verify-code" rows="8" style="width: 100%; font-family: var(--font-mono); font-size: 0.85rem;" placeholder="// Paste JavaScript, TypeScript, Python, or cURL code to verify&#10;fetch('/v1/webhook_endpoints', {&#10;  method: 'POST',&#10;  body: JSON.stringify({ url: 'https://example.com' })&#10;});"></textarea>
      </div>

      <div id="verify-results" class="card" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h3>Verification Findings</h3>
          <span id="verify-verdict" class="badge">UNKNOWN</span>
        </div>
        <div id="verify-summary" style="margin-bottom: 1rem; font-size: 0.9rem;"></div>
        <table id="verify-findings-table">
          <thead>
            <tr><th>Severity</th><th>Rule</th><th>Line</th><th>Message</th><th>Expected</th></tr>
          </thead>
          <tbody id="verify-findings-body"></tbody>
        </table>
      </div>
    </section>

    <!-- EXPORT CENTER TAB -->
    <section id="tab-export" class="tab-content">
      <div class="card" style="margin-bottom: 1.5rem;">
        <h3 style="margin-bottom: 0.5rem;">Deterministic Agent File Exports</h3>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
          Generate reproducible, version-aware agent configuration and guidance files.
        </p>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem;">
          <button class="btn btn-secondary" onclick="loadExport('agents.md')">Preview AGENTS.md</button>
          <button class="btn btn-secondary" onclick="loadExport('claude.md')">Preview CLAUDE.md</button>
          <button class="btn btn-secondary" onclick="loadExport('skill.md')">Preview skill.md</button>
          <button class="btn btn-secondary" onclick="loadExport('llms.txt')">Preview llms.txt</button>
          <button class="btn btn-secondary" onclick="loadExport('docs-map.md')">Preview docs-map.md</button>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <strong id="export-filename">AGENTS.md</strong>
          <button class="btn" style="padding: 0.3rem 0.75rem; font-size: 0.8rem;" onclick="copyExportContent()">Copy to Clipboard</button>
        </div>
        <pre id="export-preview" style="max-height: 500px;">Click a button above to generate export preview...</pre>
      </div>
    </section>
  </main>

  <script>
    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      const target = document.getElementById('tab-' + tabId);
      if (target) target.classList.add('active');

      if (tabId === 'overview') loadStats();
      if (tabId === 'apis') loadApis();
      if (tabId === 'pitfalls') loadPitfalls();
      if (tabId === 'examples') loadExamples();
      if (tabId === 'docsmap') loadDocsMap();
      if (tabId === 'export') loadExport('agents.md');
    }

    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        document.getElementById('stat-sources').textContent = data.totalSources || 0;
        document.getElementById('stat-pages').textContent = data.totalPages || 0;
        document.getElementById('stat-chunks').textContent = data.totalChunks || 0;
        document.getElementById('stat-apis').textContent = data.totalApis || 0;
        document.getElementById('stat-pitfalls').textContent = data.totalPitfalls || 0;
        document.getElementById('stat-examples').textContent = data.totalExamples || 0;

        const vList = document.getElementById('versions-list');
        if (data.activeVersions && data.activeVersions.length > 0) {
          vList.innerHTML = data.activeVersions.map(v => '<span class="badge badge-primary">' + v + '</span>').join('');
        } else {
          vList.innerHTML = '<em>No explicit version tags indexed.</em>';
        }

        const sRes = await fetch('/api/sources');
        const sources = await sRes.json();
        const sList = document.getElementById('sources-list');
        if (sources && sources.length > 0) {
          sList.innerHTML = '<ul>' + sources.map(s => '<li><strong>' + s.url + '</strong> (' + s.authority + ')</li>').join('') + '</ul>';
        } else {
          sList.innerHTML = '<em>No sources indexed. Run <code>docorbit add &lt;url&gt;</code> to index documentation.</em>';
        }
      } catch (err) {
        document.getElementById('conn-badge').textContent = 'Disconnected';
        document.getElementById('conn-badge').className = 'badge badge-danger';
      }
    }

    async function loadApis() {
      const q = document.getElementById('api-search').value;
      const method = document.getElementById('api-method').value;
      const docVersion = document.getElementById('api-version').value;
      const url = new URL('/api/apis', window.location.origin);
      if (q) url.searchParams.set('q', q);
      if (method) url.searchParams.set('method', method);
      if (docVersion) url.searchParams.set('docVersion', docVersion);

      const res = await fetch(url);
      const apis = await res.json();
      const body = document.getElementById('apis-body');
      if (!apis || apis.length === 0) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center;">No matching APIs found.</td></tr>';
        return;
      }

      body.innerHTML = apis.map(ep => {
        const mClass = 'method-' + ep.method.toLowerCase();
        const req = (ep.parameters || []).filter(p => p.required).map(p => '<code>' + p.name + '</code>').join(', ') || 'none';
        const dep = ep.deprecated ? ' <span class="badge badge-danger">deprecated</span>' : '';
        return '<tr>' +
          '<td><span class="method-pill ' + mClass + '">' + ep.method + '</span>' + dep + '</td>' +
          '<td><code>' + ep.path + '</code></td>' +
          '<td>' + (ep.summary || '') + '</td>' +
          '<td>' + req + '</td>' +
          '<td>' + (ep.docVersion || '-') + '</td>' +
          '</tr>';
      }).join('');
    }

    async function loadPitfalls() {
      const q = document.getElementById('pitfall-search').value;
      const kind = document.getElementById('pitfall-kind').value;
      const url = new URL('/api/pitfalls', window.location.origin);
      if (q) url.searchParams.set('q', q);
      if (kind) url.searchParams.set('kind', kind);

      const res = await fetch(url);
      const pitfalls = await res.json();
      const container = document.getElementById('pitfalls-list');
      if (!pitfalls || pitfalls.length === 0) {
        container.innerHTML = '<div class="card">No pitfalls found.</div>';
        return;
      }

      container.innerHTML = pitfalls.map(pf => {
        const sevClass = pf.severity === 'error' ? 'badge-danger' : (pf.severity === 'info' ? 'badge-primary' : 'badge-warning');
        return '<div class="card">' +
          '<div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">' +
            '<h4>' + pf.title + '</h4>' +
            '<div><span class="badge ' + sevClass + '">' + (pf.severity || 'warning') + '</span> <span class="badge badge-primary">' + pf.kind + '</span></div>' +
          '</div>' +
          '<p style="font-size:0.9rem; margin-bottom:0.5rem;">' + pf.message + '</p>' +
          (pf.mitigation ? '<p style="font-size:0.85rem; color:var(--accent);"><strong>Fix:</strong> ' + pf.mitigation + '</p>' : '') +
          '</div>';
      }).join('');
    }

    async function loadExamples() {
      const q = document.getElementById('example-search').value;
      const fw = document.getElementById('example-framework').value;
      const url = new URL('/api/examples', window.location.origin);
      if (q) url.searchParams.set('q', q);
      if (fw) url.searchParams.set('framework', fw);

      const res = await fetch(url);
      const examples = await res.json();
      const container = document.getElementById('examples-list');
      if (!examples || examples.length === 0) {
        container.innerHTML = '<div class="card">No code examples found.</div>';
        return;
      }

      container.innerHTML = examples.map(ex => {
        return '<div class="card">' +
          '<div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">' +
            '<h4>' + (ex.task || ex.title || 'Example') + '</h4>' +
            '<span class="badge badge-primary">' + (ex.framework || ex.language || 'code') + '</span>' +
          '</div>' +
          '<pre><code>' + (ex.code || ex.rawSnippet || '').trim() + '</code></pre>' +
          '</div>';
      }).join('');
    }

    async function loadDocsMap() {
      const res = await fetch('/api/docs-map');
      const data = await res.json();
      document.getElementById('docsmap-content').textContent = data.markdownTree || 'No map available.';
    }

    async function runVerify() {
      const code = document.getElementById('verify-code').value;
      const docVersion = document.getElementById('verify-version').value;
      if (!code.trim()) return;

      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, version: docVersion || undefined })
      });
      const data = await res.json();
      const result = data.result || data;

      const resultsDiv = document.getElementById('verify-results');
      resultsDiv.style.display = 'block';

      const vBadge = document.getElementById('verify-verdict');
      vBadge.textContent = result.verdict ? result.verdict.toUpperCase() : 'UNKNOWN';
      vBadge.className = 'badge ' + (
        result.verdict === 'verified' ? 'badge-success' :
        result.verdict === 'warning' ? 'badge-warning' :
        result.verdict === 'mismatch' ? 'badge-danger' : 'badge-primary'
      );

      document.getElementById('verify-summary').textContent = result.summary || '';

      const tbody = document.getElementById('verify-findings-body');
      if (!result.findings || result.findings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No issues detected. Code is verified against indexed schemas.</td></tr>';
      } else {
        tbody.innerHTML = result.findings.map(f => {
          const sevClass = f.severity === 'error' ? 'badge-danger' : (f.severity === 'info' ? 'badge-primary' : 'badge-warning');
          return '<tr>' +
            '<td><span class="badge ' + sevClass + '">' + f.severity + '</span></td>' +
            '<td>' + f.rule + '</td>' +
            '<td>' + (f.location?.line || '-') + '</td>' +
            '<td>' + f.message + '</td>' +
            '<td>' + (f.expected || '-') + '</td>' +
            '</tr>';
        }).join('');
      }
    }

    async function loadExport(format) {
      document.getElementById('export-filename').textContent = format;
      const preview = document.getElementById('export-preview');
      preview.textContent = 'Generating export...';

      const res = await fetch('/api/export?format=' + encodeURIComponent(format));
      const data = await res.json();
      preview.textContent = data.content || '';
    }

    function copyExportContent() {
      const text = document.getElementById('export-preview').textContent;
      navigator.clipboard.writeText(text);
      alert('Copied ' + document.getElementById('export-filename').textContent + ' to clipboard!');
    }

    // Initial load
    loadStats();
  </script>
</body>
</html>`;
}
