/**
 * DocOrbit Landing Page & Docs Interactive Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Interactive Agent Prompt Studio Tabs
  const promptTabs = document.querySelectorAll('.prompt-tab');
  const promptPanes = document.querySelectorAll('.prompt-pane');

  promptTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-ptab');

      promptTabs.forEach((t) => t.classList.remove('active'));
      promptPanes.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const pane = document.getElementById(`ptab-${target}`);
      if (pane) {
        pane.classList.add('active');
      }
    });
  });

  // 2. Multi-Harness Configuration Tabs
  const hTabs = document.querySelectorAll('.h-tab');
  const hPanels = document.querySelectorAll('.h-panel');

  hTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-h');

      hTabs.forEach((t) => t.classList.remove('active'));
      hPanels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const panel = document.getElementById(`hp-${target}`);
      if (panel) {
        panel.classList.add('active');
      }
    });
  });

  // 3. 15 MCP Tools Category Filter
  const tfBtns = document.querySelectorAll('.tf-btn');
  const toolItems = document.querySelectorAll('.tool-item');

  tfBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-f');

      tfBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      toolItems.forEach((item) => {
        const group = item.getAttribute('data-group');
        if (filter === 'all' || group === filter) {
          item.style.display = 'block';
        } else {
          item.style.display = 'none';
        }
      });
    });
  });

  // 4. One-Click Copy Buttons
  const copyButtons = document.querySelectorAll('.copy-btn');
  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy');
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const original = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Copied!</span>
        `;

        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = original;
        }, 2000);
      } catch (err) {
        console.error('Clipboard copy error:', err);
      }
    });
  });

  // 5. Smooth Scrolling for Internal Hash Anchors
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (!targetId || targetId === '#') return;

      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        const headerOffset = 72;
        const top = targetEl.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  });
});
