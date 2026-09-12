import type { Heading, Link, CodeExample } from '../../shared/src/index.ts';

export interface ExtractedHtmlDoc {
  title: string;
  markdown: string;
  headings: Heading[];
  links: Link[];
  codeExamples: CodeExample[];
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deterministically normalizes HTML documentation into clean Markdown,
 * preserving code fences, language tags, headings, tables, callouts, and links.
 */
export function normalizeHtmlToMarkdown(html: string, baseUrl: string): ExtractedHtmlDoc {
  const headings: Heading[] = [];
  const links: Link[] = [];
  const codeExamples: CodeExample[] = [];

  let title = '';

  // 1. Extract title from <title> tag if present
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = unescapeHtml(titleMatch[1]).replace(/\s+/g, ' ').trim();
    title = title.split(/\s+[|–—-]\s+/)[0].trim();
  }

  // 2. Extract embedded Markdoc / client-hydration code blocks before stripping scripts
  const embeddedCodeBlocks: Array<{ language: string; filename?: string; code: string }> = [];

  const unescapeUnicode = (str: string): string => {
    return str
      .replace(/\\u0028/g, '(')
      .replace(/\\u0029/g, ')')
      .replace(/\\u0022/g, '"')
      .replace(/\\u0027/g, "'")
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u0026/g, '&')
      .replace(/\\u002f/gi, '/')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, '  ')
      .replace(/\\\\/g, '\\');
  };

  // 2a. Next.js __NEXT_DATA__ inspection
  const nextDataMatch = html.match(/<script\b[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const pageProps = nextData?.props?.pageProps;
      if (pageProps && typeof pageProps === 'object') {
        const findSnippets = (obj: unknown, depth = 0) => {
          if (!obj || depth > 5) return;
          if (typeof obj === 'object') {
            const rec = obj as Record<string, unknown>;
            if (typeof rec.code === 'string' && rec.code.trim().length > 15) {
              const lang = typeof rec.language === 'string' ? rec.language : (typeof rec.lang === 'string' ? rec.lang : 'typescript');
              const fn = typeof rec.filename === 'string' ? rec.filename : (typeof rec.file === 'string' ? rec.file : (typeof rec.title === 'string' ? rec.title : undefined));
              embeddedCodeBlocks.push({ language: lang, filename: fn, code: rec.code.trim() });
            } else if (typeof rec.snippet === 'string' && rec.snippet.trim().length > 15) {
              const lang = typeof rec.language === 'string' ? rec.language : 'typescript';
              embeddedCodeBlocks.push({ language: lang, code: rec.snippet.trim() });
            }
            for (const val of Object.values(rec)) findSnippets(val, depth + 1);
          } else if (Array.isArray(obj)) {
            for (const item of obj) findSnippets(item, depth + 1);
          }
        };
        findSnippets(pageProps);
      }
    } catch {}
  }

  // 2b. Generalized AST / Markdoc Component Blocks (File, Chunk, Code, CodeBlock, Snippet, CodeGroup, CodeTab)
  const compRegex = /"name"\s*:\s*"(?:File|Chunk|Code|CodeBlock|Snippet|CodeGroup|CodeTab)"\s*,\s*"attributes"\s*:\s*\{([^}]+)\}\s*,\s*"children"\s*:\s*\[([\s\S]*?)\]\s*\}\s*\]/gi;
  let compMatch: RegExpExecArray | null;
  while ((compMatch = compRegex.exec(html)) !== null) {
    const attrStr = compMatch[1];
    const childrenStr = compMatch[2];
    const langMatch = attrStr.match(/"(?:language|lang)"\s*:\s*"([^"]+)"/i);
    const fileMatch = attrStr.match(/"(?:filename|file|title)"\s*:\s*"([^"]+)"/i);
    const lang = langMatch ? langMatch[1] : 'javascript';
    const filename = fileMatch ? unescapeUnicode(fileMatch[1]) : undefined;

    const chunkMatches = childrenStr.match(/"chunks"\s*:\s*\[\s*"([\s\S]*?)"\s*\]/g) || [];
    let assembled = '';
    for (const c of chunkMatches) {
      const inner = c.replace(/^"chunks"\s*:\s*\[\s*"/, '').replace(/"\s*\]$/, '');
      assembled += unescapeUnicode(inner) + '\n';
    }
    if (!assembled) {
      const stringMatches = childrenStr.match(/"(?:chunks|children)"\s*:\s*\[\s*"([^"]+)"/g) || [];
      for (const sm of stringMatches) {
        const cleaned = sm.replace(/.*\[\s*"/, '');
        assembled += unescapeUnicode(cleaned) + '\n';
      }
    }
    if (assembled.trim().length > 20 && !embeddedCodeBlocks.some(b => b.code === assembled.trim())) {
      embeddedCodeBlocks.push({
        language: lang,
        filename,
        code: assembled.trim(),
      });
    }
  }

  // 2c. Fallback for standalone Chunk / Code tags with language attribute
  if (embeddedCodeBlocks.length === 0 && (html.includes('"$$mdtype":"Tag"') || html.includes('"language":'))) {
    const chunkRegex = /"name"\s*:\s*"(?:Chunk|Code|Snippet)"\s*,\s*"attributes"\s*:\s*\{[^}]*?"(?:language|lang)"\s*:\s*"([^"]+)"[^}]*\}\s*,\s*"chunks"\s*:\s*\[\s*"([\s\S]*?)"\s*\]/gi;
    let cm: RegExpExecArray | null;
    const byLang = new Map<string, string[]>();
    while ((cm = chunkRegex.exec(html)) !== null) {
      const lang = cm[1];
      const code = unescapeUnicode(cm[2]);
      if (!byLang.has(lang)) byLang.set(lang, []);
      byLang.get(lang)!.push(code);
    }
    for (const [lang, parts] of byLang.entries()) {
      const joined = parts.join('\n').trim();
      if (!embeddedCodeBlocks.some(b => b.code === joined)) {
        embeddedCodeBlocks.push({
          language: lang,
          code: joined,
        });
      }
    }
  }

  // 2d. Elements with data-code or data-snippet attributes (e.g. Prism, Highlight.js, custom SPA wrappers)
  const dataCodeRegex = /data-(?:code|snippet|source)=["']([^"']{30,})["']/gi;
  let dataMatch: RegExpExecArray | null;
  while ((dataMatch = dataCodeRegex.exec(html)) !== null) {
    try {
      let val = unescapeHtml(dataMatch[1]);
      if (val.startsWith('%')) {
        try { val = decodeURIComponent(val); } catch {}
      }
      if (val.length > 20 && !embeddedCodeBlocks.some(b => b.code === val.trim())) {
        embeddedCodeBlocks.push({
          language: 'typescript',
          code: val.trim(),
        });
      }
    } catch {}
  }

  // Remove non-content / boilerplate tags
  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<div\b[^>]*(?:class|id)=["'][^"']*\b(?:sidebar|nav|menu|navbar|footer|cookie-banner|breadcrumbs)\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '');

  // 3. Extract and preserve code blocks
  const codeBlockPlaceholders: string[] = [];
  cleaned = cleaned.replace(/<pre\b[^>]*>(?:<code\b([^>]*)>)?([\s\S]*?)(?:<\/code>)?<\/pre>/gi, (_, codeAttrs, codeBody) => {
    let lang = '';
    if (codeAttrs) {
      const langMatch = codeAttrs.match(/\b(?:class|data-language)=["'][^"']*\b(?:language-|lang-)?([a-zA-Z0-9_-]+)\b[^"']*["']/i);
      if (langMatch && !['hljs', 'code'].includes(langMatch[1].toLowerCase())) {
        lang = langMatch[1].toLowerCase();
      }
    }

    const rawCode = unescapeHtml(codeBody.replace(/<[^>]+>/g, '')).trim();
    if (!rawCode) return '';

    const exampleId = `code_${codeExamples.length + 1}`;
    codeExamples.push({
      id: exampleId,
      language: lang || 'text',
      code: rawCode,
    });

    const placeholder = `__DOCORBIT_CODE_BLOCK_${codeBlockPlaceholders.length}__`;
    codeBlockPlaceholders.push(`\n\`\`\`${lang}\n${rawCode}\n\`\`\`\n`);
    return placeholder;
  });

  // 4. Extract Headings and build anchors
  cleaned = cleaned.replace(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi, (_, levelStr, attrs, innerText) => {
    const level = parseInt(levelStr, 10);
    const plainText = unescapeHtml(innerText.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!plainText) return '';

    let anchor = '';
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/i);
    if (idMatch) {
      anchor = idMatch[1];
    } else {
      anchor = slugify(plainText);
    }

    headings.push({ level, text: plainText, anchor });
    const hashes = '#'.repeat(level);
    return `\n\n${hashes} ${plainText}\n\n`;
  });

  // Prefer first H1 as title, otherwise fallback to HTML title, then first heading
  const h1 = headings.find(h => h.level === 1);
  if (h1) {
    title = h1.text;
  } else if (!title && headings.length > 0) {
    title = headings[0].text;
  }
  if (!title) {
    title = 'Documentation Page';
  }

  // 5. Extract and normalize Links
  cleaned = cleaned.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
    const text = unescapeHtml(linkText.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text || href.startsWith('#') || href.startsWith('javascript:')) return text;

    let absoluteUrl = href;
    let isExternal = false;
    try {
      const resolved = new URL(href, baseUrl);
      absoluteUrl = resolved.href;
      const baseHost = new URL(baseUrl).hostname;
      isExternal = resolved.hostname !== baseHost;
    } catch {
      // Keep raw href
    }

    links.push({
      text,
      url: absoluteUrl,
      isExternal,
    });

    return `[${text}](${absoluteUrl})`;
  });

  // 6. Handle Callouts & Blockquotes
  cleaned = cleaned.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    const blockText = inner
      .replace(/<p\b[^>]*>/gi, '')
      .replace(/<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    const cleanLines = unescapeHtml(blockText)
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => `> ${l}`)
      .join('\n');
    return `\n\n${cleanLines}\n\n`;
  });

  cleaned = cleaned.replace(/<div\b[^>]*\bclass=["'][^"']*\b(?:alert|callout|admonition|tip|warning|note|info)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, (_, inner) => {
    const alertText = unescapeHtml(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!alertText) return '';
    return `\n\n> [!NOTE]\n> ${alertText}\n\n`;
  });

  // 7. Handle Tables
  cleaned = cleaned.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows: string[][] = [];
    const rowMatches = tableContent.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);

    for (const rMatch of rowMatches) {
      const rowContent = rMatch[1];
      const cells: string[] = [];
      const cellMatches = rowContent.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi);
      for (const cMatch of cellMatches) {
        const cellText = unescapeHtml(cMatch[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        cells.push(cellText);
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) return '';

    const colCount = Math.max(...rows.map(r => r.length));
    const headerRow = rows[0].map(c => c || '-');
    while (headerRow.length < colCount) headerRow.push('-');

    const delimiterRow = Array(colCount).fill('---');
    const tableLines = [
      `| ${headerRow.join(' | ')} |`,
      `| ${delimiterRow.join(' | ')} |`,
    ];

    for (let i = 1; i < rows.length; i++) {
      const dataRow = rows[i].map(c => c || '');
      while (dataRow.length < colCount) dataRow.push('');
      tableLines.push(`| ${dataRow.join(' | ')} |`);
    }

    return `\n\n${tableLines.join('\n')}\n\n`;
  });

  // 8. Handle Lists
  cleaned = cleaned
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
      const text = unescapeHtml(inner.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      return `\n- ${text}`;
    })
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n');

  // 9. Handle Inline elements
  cleaned = cleaned
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => {
      const text = unescapeHtml(inner.replace(/<[^>]+>/g, '')).trim();
      return text ? `\`${text}\`` : '';
    })
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, inner) => {
      const text = inner.trim();
      return text ? `**${text}**` : '';
    })
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, inner) => {
      const text = inner.trim();
      return text ? `*${text}*` : '';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|section|article|main)\b[^>]*>/gi, '\n\n');

  // 10. Strip all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // 11. Restore preserved code blocks and append embedded Markdoc code
  for (let i = 0; i < codeBlockPlaceholders.length; i++) {
    cleaned = cleaned.replace(`__DOCORBIT_CODE_BLOCK_${i}__`, codeBlockPlaceholders[i]);
  }

  if (embeddedCodeBlocks.length > 0) {
    let embeddedMd = '\n\n## Verified Code Examples\n\n';
    for (const ec of embeddedCodeBlocks) {
      const exampleId = `code_${codeExamples.length + 1}`;
      codeExamples.push({
        id: exampleId,
        language: ec.language || 'typescript',
        code: ec.code,
      });
      const header = ec.filename ? `### ${ec.filename}\n` : '';
      embeddedMd += `${header}\`\`\`${ec.language}\n${ec.code}\n\`\`\`\n\n`;
    }
    cleaned += embeddedMd;
  }

  // 12. Normalize whitespace
  cleaned = unescapeHtml(cleaned)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    title,
    markdown: cleaned,
    headings,
    links,
    codeExamples,
  };
}
