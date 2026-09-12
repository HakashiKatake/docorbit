import { resolveDefaultDbPath, DocOrbitDb, DocOrbitRepository } from '../../../../packages/storage/src/index.ts';
import { SecureFetcher, DocumentationTreeCrawler } from '../../../../packages/crawler/src/index.ts';
import { DocumentationRootFinder } from '../../../../packages/discovery/src/index.ts';
import type { DocumentationTreeNode } from '../../../../packages/shared/src/index.ts';

export interface DiscoverCommandOptions {
  projectDir?: string;
  isGlobal?: boolean;
  dbPath?: string;
  maxPages?: number;
  maxDepth?: number;
  json?: boolean;
  allowLocalhost?: boolean;
}

function renderTreeLines(node: DocumentationTreeNode, prefix = '', isLast = true, isRoot = true): string[] {
  const lines: string[] = [];

  if (isRoot) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const isLastChild = i === node.children.length - 1;
      lines.push(...renderTreeLines(child, '', isLastChild, false));
    }
    return lines;
  }

  const connector = isLast ? '└── ' : '├── ';
  const titleDisplay = node.title || node.url;
  const typeTag = node.pageType ? ` [${node.pageType}]` : '';
  lines.push(`${prefix}${connector}${titleDisplay}${typeTag}`);

  const childPrefix = prefix + (isLast ? '    ' : '│   ');
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const isLastChild = i === node.children.length - 1;
    lines.push(...renderTreeLines(child, childPrefix, isLastChild, false));
  }

  return lines;
}

export async function runDiscoverCommand(targetUrl: string, options: DiscoverCommandOptions = {}): Promise<void> {
  if (!targetUrl) {
    console.error('Error: Missing target URL. Usage: docorbit discover <url>');
    process.exit(1);
  }

  const fetcher = new SecureFetcher({
    allowLocalhostForTesting: options.allowLocalhost ?? false,
    timeoutMs: 10000,
  });

  const rootFinder = new DocumentationRootFinder();
  const rootResult = await rootFinder.findDocumentationRoot(targetUrl, fetcher);

  const docRootUrl = rootResult.detection.isDocumentation ? rootResult.rootUrl : targetUrl;

  const maxPages = options.maxPages ?? 50;
  const maxDepth = options.maxDepth ?? 5;

  const treeCrawler = new DocumentationTreeCrawler(fetcher);
  const treeResult = await treeCrawler.crawlTree(docRootUrl, {
    maxPages,
    maxDepth,
  });

  if (options.json) {
    console.log(JSON.stringify(treeResult, null, 2));
    return;
  }

  const detection = treeResult.siteDetection;
  const frameworkDisplay = detection.framework
    ? detection.framework.charAt(0).toUpperCase() + detection.framework.slice(1)
    : 'Custom / Static';
  const typeDisplay = detection.documentationType
    ? detection.documentationType.replace(/_/g, ' ') + ' documentation'
    : 'Documentation';
  const versionDisplay = detection.docVersion || 'Latest / Undefined';
  const confidencePercent = Math.round(detection.confidence * 100);

  console.log('Documentation discovered:');
  console.log(docRootUrl);
  console.log();
  console.log('Framework:');
  console.log(frameworkDisplay);
  console.log();
  console.log('Type:');
  console.log(typeDisplay);
  console.log();
  console.log('Version:');
  console.log(versionDisplay);
  console.log();
  console.log('Confidence:');
  console.log(`${confidencePercent}% (${detection.explanation})`);
  console.log();

  if (treeResult.bounded && treeResult.boundedReason) {
    console.log(`Discovery bounded: ${treeResult.boundedReason}`);
    console.log();
  }

  console.log(
    `Pages discovered: ${treeResult.pagesDiscovered} (Indexed: ${treeResult.pagesIndexed}, Skipped: ${treeResult.pagesSkipped.length})`
  );
  console.log();
  console.log('Documentation tree:');

  const treeLines = renderTreeLines(treeResult.tree);
  if (treeLines.length > 0) {
    console.log(treeLines.join('\n'));
  } else {
    console.log(`└── ${treeResult.tree.title} (${treeResult.tree.url})`);
  }

  console.log();
  console.log('Primary source:');
  console.log(docRootUrl);

  if (treeResult.pagesSkipped.length > 0) {
    console.log();
    console.log(`Skipped URLs (${treeResult.pagesSkipped.length}):`);
    const reasonsMap: Record<string, number> = {};
    for (const s of treeResult.pagesSkipped) {
      reasonsMap[s.reason] = (reasonsMap[s.reason] || 0) + 1;
    }
    for (const [reason, count] of Object.entries(reasonsMap)) {
      console.log(`  - ${reason}: ${count}`);
    }
  }

  if (treeResult.duplicateUrls.length > 0) {
    console.log();
    console.log(`Duplicate URLs filtered: ${treeResult.duplicateUrls.length}`);
  }

  if (treeResult.failedUrls.length > 0) {
    console.log();
    console.log(`Failed URLs (${treeResult.failedUrls.length}):`);
    for (const f of treeResult.failedUrls.slice(0, 5)) {
      console.log(`  - ${f.url} (${f.error})`);
    }
  }
}
