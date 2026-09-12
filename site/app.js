/**
 * DocOrbit Landing Page — Interactive Controller
 * Design System: Linear / Biome developer experience
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Hero Interactive Studio (Scenario Switcher)
  const simTabs = document.querySelectorAll('.sim-tab');
  const simCode = document.getElementById('sim-code-preview');
  const simAgentBadge = document.getElementById('sim-agent-badge');
  const simLatencyBadge = document.getElementById('sim-latency-badge');
  const simTelemetryFeed = document.getElementById('sim-telemetry-feed');

  const scenarios = {
    nextjs: {
      agentBadge: { text: 'Next.js 14 → 15 Drift', class: 'amber' },
      latency: '1.2ms latency',
      code: `<span class="code-comment">// Agent task: Next.js Dynamic Route Handler</span>
<span class="code-comment">// Project lockfile: package.json ("next": "^15.1.0")</span>

<span class="code-comment">// ❌ WITHOUT DOCORBIT (Agent hallucinates v14 sync syntax):</span>
export async function GET(request, { params }) {
  <span class="code-err">const id = params.id;</span> <span class="code-comment">// ERROR: params is a Promise!</span>
}

<span class="code-comment">// ✔ WITH DOCORBIT (AST contract resolved to Next 15):</span>
export async function GET(request, { params }) {
  <span class="code-ok">const { id } = await params;</span> <span class="code-comment">// VERIFIED</span>
  return Response.json({ id });
}`,
      telemetry: [
        { step: '01 LOCKFILE', val: 'Scanned <code>package.json</code>: detected <strong>next@15.1.0</strong>', badge: { text: 'Ecosystem: npm', class: 'cyan' } },
        { step: '02 SEMVER', val: 'Reconciled doc version ladder: <strong>exact match → v15</strong>', badge: { text: '0 lag', class: 'green' } },
        { step: '03 AST GUARD', val: 'Flagged async params change: <strong>1 breaking contract caught</strong>', badge: { text: 'Prevented TypeError', class: 'green' } },
        { step: '04 RETRIEVAL', val: 'SQLite FTS5 batch query executed in <strong>1.24ms</strong> (3 subqueries merged)', badge: null },
        { step: '05 PAYLOAD', val: 'Packed clean Markdown: <strong>412 tokens</strong>', badge: { text: '-58% vs JSON', class: 'green' } }
      ]
    },
    stripe: {
      agentBadge: { text: 'Stripe v16 API Deprecation', class: 'amber' },
      latency: '1.4ms latency',
      code: `<span class="code-comment">// Agent task: Process customer payment & checkout</span>
<span class="code-comment">// Project lockfile: package.json ("stripe": "^16.2.0")</span>

<span class="code-comment">// ❌ WITHOUT DOCORBIT (Agent calls obsolete Charges API):</span>
<span class="code-err">const charge = await stripe.charges.create({</span>
  amount: 2000, currency: 'usd', source: token
<span class="code-err">});</span> <span class="code-comment">// WARNING: Charges API does not support SCA / 3D Secure</span>

<span class="code-comment">// ✔ WITH DOCORBIT (AST contract enforces PaymentIntents):</span>
<span class="code-ok">const intent = await stripe.paymentIntents.create({</span>
  amount: 2000, currency: 'usd', payment_method: pm
<span class="code-ok">});</span> <span class="code-comment">// VERIFIED (SCA compliant)</span>`,
      telemetry: [
        { step: '01 DETECT', val: 'Identified API call to <code>stripe.charges.create</code>', badge: { text: 'v16 OpenAPI', class: 'cyan' } },
        { step: '02 CONTRACT', val: 'Looked up Stripe OpenAPI schema: <strong>Endpoint Deprecated</strong>', badge: { text: 'Caught Gotcha', class: 'amber' } },
        { step: '03 AST CHECK', val: 'Replaced with verified modern method: <strong>stripe.paymentIntents.create</strong>', badge: { text: 'Contract Verified', class: 'green' } },
        { step: '04 RETRIEVAL', val: 'Loaded authoritative recipe chunk <code>#c_stripe_pi</code> in <strong>1.38ms</strong>', badge: null },
        { step: '05 TOKENS', val: 'Markdown recipe delivered: <strong>528 tokens</strong>', badge: { text: 'Ready', class: 'green' } }
      ]
    },
    tailwind: {
      agentBadge: { text: 'Tailwind CSS v3 → v4 Architecture', class: 'cyan' },
      latency: '1.1ms latency',
      code: `<span class="code-comment">// Agent task: Configure custom theme primary color</span>
<span class="code-comment">// Project lockfile: package.json ("tailwindcss": "^4.0.0")</span>

<span class="code-comment">// ❌ WITHOUT DOCORBIT (Agent creates obsolete tailwind.config.js):</span>
<span class="code-err">module.exports = { theme: { extend: { colors: ... } } };</span>
<span class="code-comment">// ERROR: Tailwind v4 deprecates JavaScript configuration files!</span>

<span class="code-comment">// ✔ WITH DOCORBIT (CSS theme variables in app.css):</span>
<span class="code-ok">@theme {</span>
<span class="code-ok">  --color-primary: oklch(0.65 0.24 250);</span>
<span class="code-ok">}</span> <span class="code-comment">// VERIFIED (Tailwind v4 Native CSS)</span>`,
      telemetry: [
        { step: '01 LOCKFILE', val: 'Detected <strong>tailwindcss@4.0.0</strong> in dependencies', badge: { text: 'Ecosystem: npm', class: 'cyan' } },
        { step: '02 MIGRATION', val: 'DocOrbit detected CSS-first engine: <strong>tailwind.config.js omitted</strong>', badge: { text: 'Modern Rule', class: 'green' } },
        { step: '03 RETRIEVAL', val: 'Retrieved <code>@theme</code> directive spec in <strong>1.09ms</strong> from SQLite', badge: null },
        { step: '04 AST GUARD', val: 'Checked syntax against CSS parser: <strong>0 validation errors</strong>', badge: { text: 'Verified', class: 'green' } },
        { step: '05 TOKENS', val: 'Context packed: <strong>298 tokens</strong>', badge: { text: '-64% vs JSON', class: 'green' } }
      ]
    }
  };

  if (simTabs && simCode) {
    simTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const key = tab.getAttribute('data-sim');
        const data = scenarios[key];
        if (!data) return;

        simTabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        // Update badge
        if (simAgentBadge) {
          simAgentBadge.className = `tel-badge ${data.agentBadge.class}`;
          simAgentBadge.textContent = data.agentBadge.text;
        }

        // Update latency
        if (simLatencyBadge) {
          simLatencyBadge.textContent = data.latency;
        }

        // Update code
        simCode.innerHTML = data.code;

        // Update telemetry list
        if (simTelemetryFeed) {
          simTelemetryFeed.innerHTML = data.telemetry.map((item) => `
            <div class="telemetry-item">
              <span class="tel-step">${item.step}</span>
              <span class="tel-val">${item.val} ${item.badge ? `<span class="tel-badge ${item.badge.class}">${item.badge.text}</span>` : ''}</span>
            </div>
          `).join('');
        }
      });
    });
  }

  // 2. Harness Config Tabs Switcher
  const harnessTabs = document.querySelectorAll('.harness-tab');
  const harnessPanels = document.querySelectorAll('.harness-panel');

  harnessTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');

      harnessTabs.forEach((t) => t.classList.remove('active'));
      harnessPanels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const activePanel = document.getElementById(`panel-${target}`);
      if (activePanel) {
        activePanel.classList.add('active');
      }
    });
  });

  // 3. MCP Tools Category Filter
  const filterBtns = document.querySelectorAll('.filter-btn');
  const toolCards = document.querySelectorAll('.tool-card');

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter');

      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      toolCards.forEach((card) => {
        const category = card.getAttribute('data-category');
        if (filter === 'all' || category === filter) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

  // 4. One-Click Copy Buttons
  const copyButtons = document.querySelectorAll('.copy-btn');
  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');
      if (!textToCopy) return;

      try {
        await navigator.clipboard.writeText(textToCopy);
        const originalHtml = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Copied!</span>
        `;

        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = originalHtml;
        }, 2000);
      } catch (err) {
        console.error('Clipboard copy error:', err);
      }
    });
  });

  // 5. FAQ Accordion
  const faqQuestions = document.querySelectorAll('.faq-question');
  faqQuestions.forEach((q) => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      if (!item) return;

      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach((openItem) => {
        if (openItem !== item) openItem.classList.remove('open');
      });

      if (isOpen) {
        item.classList.remove('open');
      } else {
        item.classList.add('open');
      }
    });
  });

  // 6. Smooth Scrolling for Anchors
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#' || !targetId) return;

      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        const headerOffset = 76;
        const elementPosition = targetEl.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth',
        });
      }
    });
  });
});
