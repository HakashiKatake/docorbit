/**
 * Real-world Regression Fixture: Xobin API Documentation.
 * Replicates the exact hierarchical navigation tree, collapsed/expandable nodes,
 * Sphinx framework markers, hidden HTML elements, cyclic links, duplicate URLs,
 * and marketing exclusions.
 */

export const XOBIN_ORIGIN = 'https://app.xobin.com';

export const xobinDnsLookup = async (_host: string) => [
  { address: '104.21.32.1', family: 4 },
];

export function createXobinFetch(origin: string = XOBIN_ORIGIN): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(urlStr, origin);
    const pathname = parsed.pathname.replace(/\/$/, '') || '/';

    // 1. Landing Page: https://app.xobin.com/
    if (pathname === '/' || pathname === '') {
      return new Response(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Xobin - Skills Assessment & AI Video Interview Platform</title>
          </head>
          <body>
            <header>
              <nav>
                <a href="/">Home</a>
                <a href="/pricing">Pricing</a>
                <a href="/login">Login</a>
                <a href="/api/docs/">API Docs</a>
              </nav>
            </header>
            <main>
              <h1>AI Driven Pre-Employment Assessment Platform</h1>
              <p>Automate your recruitment process with online skills assessments.</p>
              <a href="/signup">Get Started Free</a>
            </main>
            <footer>
              <a href="https://twitter.com/xobin">Twitter</a>
              <a href="/terms">Terms of Service</a>
            </footer>
          </body>
        </html>
      `, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // 2. Documentation Root: https://app.xobin.com/api/docs/
    if (pathname === '/api/docs') {
      return new Response(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Xobin API v2.0 documentation</title>
            <meta name="generator" content="Sphinx 7.2.6" />
          </head>
          <body>
            <div class="sphinxsidebar">
              <div class="sphinxsidebarwrapper">
                <h3>Table of Contents</h3>
                <ul class="toctree-l1">
                  <li><a href="/api/docs/authentication">Authentication and Rate Limiting</a></li>
                  <li><a href="/api/docs/assessment-workflows">Assessment workflows</a></li>
                  <li><a href="/api/docs/ai-interview-workflows">AI Interview Workflows</a></li>
                  <li><a href="/api/docs/webhooks">Track Applicant Webhooks</a></li>
                  
                  <!-- Collapsed & Expandable Navigation: Candidates -->
                  <li class="nav-group">
                    <details>
                      <summary>Candidates</summary>
                      <ul class="toctree-l2">
                        <li><a href="/api/docs/candidates/parse-resume">Parse Candidate Resume</a></li>
                        <li><a href="/api/docs/candidates/delete">Delete Candidate</a></li>
                        <li><a href="/api/docs/candidates/cancel-deletion">Cancel Candidate Deletion</a></li>
                      </ul>
                    </details>
                  </li>

                  <li><a href="/api/docs/assessments">Assessments</a></li>
                  <li><a href="/api/docs/assessment-settings">Assessment Settings</a></li>
                  <li><a href="/api/docs/ai-interviews">AI Interviews</a></li>
                  <li><a href="/api/docs/ai-interview-settings">AI Interview Settings</a></li>
                  <li><a href="/api/docs/tracks">Tracks</a></li>
                  <li><a href="/api/docs/xoforms">XoForms</a></li>
                  <li><a href="/api/docs/automated-interviews">Automated Interviews</a></li>
                  <li><a href="/api/docs/products">Products</a></li>

                  <!-- Duplicate links with tracking and anchors -->
                  <li><a href="/api/docs/authentication?utm_source=sidebar#rate-limit">Auth & Limits (dup)</a></li>
                  
                  <!-- Irrelevant marketing links inside docs -->
                  <li><a href="/pricing">Billing Plans</a></li>
                  <li><a href="/login">Sign In</a></li>
                </ul>

                <!-- Hidden HTML navigation element -->
                <div style="display: none;" class="hidden-menu">
                  <a href="/api/docs/hidden-feature">Hidden Integration Feature</a>
                </div>
              </div>
            </div>

            <div class="document">
              <nav aria-label="breadcrumb">
                <ol class="breadcrumb">
                  <li><a href="/api/docs">Docs</a></li>
                  <li>Overview</li>
                </ol>
              </nav>

              <main>
                <h1>Xobin API Documentation</h1>
                <p>Welcome to the Xobin REST API documentation version 2.0.</p>
                <p>Use our API to manage assessments, invite candidates, and retrieve test results programmatically.</p>
                <a rel="next" href="/api/docs/authentication">Next: Authentication</a>
              </main>

              <!-- Embedded JSON route manifest -->
              <script id="__NEXT_DATA__" type="application/json">
                {
                  "props": {
                    "pageProps": {
                      "routes": [
                        { "path": "/api/docs/dynamic-route", "title": "Dynamic Route" }
                      ]
                    }
                  }
                }
              </script>
            </div>
          </body>
        </html>
      `, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }

    // 3. Child Pages
    if (pathname === '/api/docs/authentication') {
      return new Response(`
        <!DOCTYPE html>
        <html>
          <head><title>Authentication and Rate Limiting - Xobin API</title></head>
          <body>
            <nav class="breadcrumb"><a href="/api/docs">Docs</a> / Authentication</nav>
            <h1>Authentication and Rate Limiting</h1>
            <p>All API requests require a Bearer token in the Authorization header.</p>
            <pre><code class="language-bash">curl -H "Authorization: Bearer xobin_api_key_123" https://app.xobin.com/v1/assessments</code></pre>
            <p>Rate limit: 120 requests per minute per organization.</p>
          </body>
        </html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (pathname === '/api/docs/assessment-workflows') {
      return new Response(`
        <!DOCTYPE html>
        <html><head><title>Assessment workflows - Xobin API</title></head>
        <body>
          <h1>Assessment workflows</h1>
          <p>Guide for end-to-end recruitment assessment workflow.</p>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (pathname === '/api/docs/ai-interview-workflows') {
      return new Response(`
        <!DOCTYPE html>
        <html><head><title>AI Interview Workflows - Xobin API</title></head>
        <body>
          <h1>AI Interview Workflows</h1>
          <p>Automated screening and video analysis workflows.</p>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (pathname === '/api/docs/webhooks') {
      return new Response(`
        <!DOCTYPE html>
        <html><head><title>Track Applicant Webhooks - Xobin API</title></head>
        <body>
          <h1>Track Applicant Webhooks</h1>
          <p>Configure webhook callbacks for applicant status transitions.</p>
          <pre><code class="language-json">{ "event": "applicant.completed", "score": 94 }</code></pre>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    // Nested Candidates Subpages
    if (pathname === '/api/docs/candidates/parse-resume') {
      return new Response(`
        <!DOCTYPE html>
        <html><head><title>Parse Candidate Resume - Xobin API</title></head>
        <body>
          <h1>Parse Candidate Resume</h1>
          <p>POST /v1/candidates/parse-resume</p>
          <p>Extract skills, experience, and contact info from resume PDF.</p>
          <pre><code class="language-bash">curl -X POST https://app.xobin.com/v1/candidates/parse-resume</code></pre>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (pathname === '/api/docs/candidates/delete') {
      return new Response(`
        <!DOCTYPE html>
        <html><head><title>Delete Candidate - Xobin API</title></head>
        <body>
          <h1>Delete Candidate</h1>
          <p>DELETE /v1/candidates/{candidate_id}</p>
          <p>Removes a candidate record and all associated test records.</p>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (pathname === '/api/docs/candidates/cancel-deletion') {
      return new Response(`
        <!DOCTYPE html>
        <html><head><title>Cancel Candidate Deletion - Xobin API</title></head>
        <body>
          <h1>Cancel Candidate Deletion</h1>
          <p>POST /v1/candidates/{candidate_id}/restore</p>
          <p>Restores a candidate scheduled for deletion.</p>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (pathname === '/api/docs/assessments') {
      return new Response(`<html><head><title>Assessments - Xobin API</title></head><body><h1>Assessments</h1><p>GET /v1/assessments</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (pathname === '/api/docs/assessment-settings') {
      return new Response(`<html><head><title>Assessment Settings - Xobin API</title></head><body><h1>Assessment Settings</h1></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (pathname === '/api/docs/ai-interviews') {
      return new Response(`<html><head><title>AI Interviews - Xobin API</title></head><body><h1>AI Interviews</h1></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (pathname === '/api/docs/ai-interview-settings') {
      return new Response(`<html><head><title>AI Interview Settings - Xobin API</title></head><body><h1>AI Interview Settings</h1></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    // Cyclic links between Tracks and XoForms
    if (pathname === '/api/docs/tracks') {
      return new Response(`
        <html><head><title>Tracks - Xobin API</title></head><body>
          <h1>Tracks</h1>
          <p>Role-based assessment tracks.</p>
          <a href="/api/docs/xoforms">See XoForms Integration</a>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (pathname === '/api/docs/xoforms') {
      return new Response(`
        <html><head><title>XoForms - Xobin API</title></head><body>
          <h1>XoForms</h1>
          <p>Custom candidate intake forms.</p>
          <a href="/api/docs/tracks">Back to Tracks</a>
        </body></html>
      `, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    if (pathname === '/api/docs/automated-interviews') {
      return new Response(`<html><head><title>Automated Interviews - Xobin API</title></head><body><h1>Automated Interviews</h1></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (pathname === '/api/docs/products') {
      return new Response(`<html><head><title>Products - Xobin API</title></head><body><h1>Products</h1></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    // Hidden feature & dynamic route
    if (pathname === '/api/docs/hidden-feature') {
      return new Response(`<html><head><title>Hidden Feature</title></head><body><h1>Hidden Integration Feature</h1></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (pathname === '/api/docs/dynamic-route') {
      return new Response(`<html><head><title>Dynamic Route</title></head><body><h1>Dynamic Route Page</h1></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    // Irrelevant pages (should not be indexed by doc tree crawler)
    if (pathname === '/pricing') {
      return new Response(`<html><body><h1>Pricing Plans</h1><p>$49/month</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (pathname === '/login') {
      return new Response(`<html><body><h1>Login to your account</h1></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }

    return new Response('Not Found', { status: 404 });
  };
}
