import test from 'node:test';
import assert from 'node:assert';
import { rankSources } from '../../packages/discovery/src/index.ts';
import type { DiscoveredSource } from '../../packages/shared/src/index.ts';

const mockSources: DiscoveredSource[] = [
  {
    url: 'https://docs.example.com',
    type: 'web',
    discoveredBy: 'generic_web',
    status: 'valid',
    confidence: 0.85,
    authority: 'official',
    machineReadable: false,
  },
  {
    url: 'https://docs.example.com/llms.txt',
    type: 'llms_txt',
    discoveredBy: 'llms_txt',
    status: 'valid',
    confidence: 0.98,
    authority: 'official',
    machineReadable: true,
  },
  {
    url: 'https://docs.example.com/openapi.json',
    type: 'openapi',
    discoveredBy: 'openapi',
    status: 'valid',
    confidence: 0.99,
    authority: 'official',
    machineReadable: true,
  },
  {
    url: 'https://github.com/example/sdk',
    type: 'github',
    discoveredBy: 'github',
    status: 'valid',
    confidence: 0.90,
    authority: 'official',
    machineReadable: false,
  },
  {
    url: 'https://docs.example.com/skill.md',
    type: 'skill',
    discoveredBy: 'skill',
    status: 'valid',
    confidence: 0.95,
    authority: 'official',
    machineReadable: true,
  },
];

test('rankSources ranks openapi highest for purpose "api"', () => {
  const result = rankSources(mockSources, 'api');
  assert.strictEqual(result.recommended?.type, 'openapi');
  assert.strictEqual(result.recommended?.url, 'https://docs.example.com/openapi.json');
});

test('rankSources ranks llms_txt highest for purpose "navigation"', () => {
  const result = rankSources(mockSources, 'navigation');
  assert.strictEqual(result.recommended?.type, 'llms_txt');
  assert.strictEqual(result.recommended?.url, 'https://docs.example.com/llms.txt');
});

test('rankSources ranks github highest for purpose "examples"', () => {
  const result = rankSources(mockSources, 'examples');
  assert.strictEqual(result.recommended?.type, 'github');
  assert.strictEqual(result.recommended?.url, 'https://github.com/example/sdk');
});

test('rankSources ranks skill highest for purpose "implementation"', () => {
  const result = rankSources(mockSources, 'implementation');
  assert.strictEqual(result.recommended?.type, 'skill');
  assert.strictEqual(result.recommended?.url, 'https://docs.example.com/skill.md');
});

test('rankSources handles empty sources gracefully', () => {
  const result = rankSources([], 'conceptual');
  assert.strictEqual(result.recommended, null);
  assert.strictEqual(result.ranked.length, 0);
});
