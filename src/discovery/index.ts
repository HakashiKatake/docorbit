import { DiscoveryCoordinator } from './provider.ts';
import { LlmsTxtProvider } from './providers/llms-txt.ts';
import { OpenApiProvider } from './providers/openapi.ts';
import { MarkdownProvider } from './providers/markdown.ts';
import { SitemapProvider } from './providers/sitemap.ts';
import { GithubProvider } from './providers/github.ts';
import { SkillProvider } from './providers/skill.ts';
import { GenericWebProvider } from './providers/generic.ts';

export * from './provider.ts';
export * from './ranker.ts';
export * from './providers/llms-txt.ts';
export * from './providers/openapi.ts';
export * from './providers/markdown.ts';
export * from './providers/sitemap.ts';
export * from './providers/github.ts';
export * from './providers/skill.ts';
export * from './providers/generic.ts';
export * from './detector.ts';
export * from './root-finder.ts';

export function createDefaultDiscoveryCoordinator(): DiscoveryCoordinator {
  const coordinator = new DiscoveryCoordinator();
  coordinator
    .register(new LlmsTxtProvider())
    .register(new OpenApiProvider())
    .register(new MarkdownProvider())
    .register(new SitemapProvider())
    .register(new SkillProvider())
    .register(new GithubProvider())
    .register(new GenericWebProvider());
  return coordinator;
}
