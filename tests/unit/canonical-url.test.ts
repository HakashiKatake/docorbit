import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeSourceUrl } from '../../packages/shared/src/index.ts';

test('canonicalizeSourceUrl: lowercases protocol and domain', () => {
  const result = canonicalizeSourceUrl('HTTPS://DOCS.GITHUB.COM/en');
  assert.strictEqual(result, 'https://docs.github.com/en');
});

test('canonicalizeSourceUrl: strips trailing slash on paths', () => {
  const result = canonicalizeSourceUrl('https://docs.github.com/en/');
  assert.strictEqual(result, 'https://docs.github.com/en');
});

test('canonicalizeSourceUrl: preserves root path trailing slash', () => {
  const result = canonicalizeSourceUrl('https://docs.github.com/');
  assert.strictEqual(result, 'https://docs.github.com/');
});

test('canonicalizeSourceUrl: collapses multiple consecutive path slashes', () => {
  const result = canonicalizeSourceUrl('https://example.com//docs///api//endpoints/');
  assert.strictEqual(result, 'https://example.com/docs/api/endpoints');
});

test('canonicalizeSourceUrl: strips URL fragments (#...)', () => {
  const result = canonicalizeSourceUrl('https://docs.stripe.com/api#authentication');
  assert.strictEqual(result, 'https://docs.stripe.com/api');
});

test('canonicalizeSourceUrl: strips marketing and tracking query parameters', () => {
  const input = 'https://docs.stripe.com/api?utm_source=google&utm_medium=cpc&ref=twitter&gclid=12345&version=v1';
  const result = canonicalizeSourceUrl(input);
  assert.strictEqual(result, 'https://docs.stripe.com/api?version=v1');
});

test('canonicalizeSourceUrl: sorts remaining query parameters deterministically', () => {
  const input1 = 'https://api.example.com/search?q=billing&sort=desc&limit=10';
  const input2 = 'https://api.example.com/search?limit=10&sort=desc&q=billing';
  assert.strictEqual(canonicalizeSourceUrl(input1), canonicalizeSourceUrl(input2));
  assert.strictEqual(canonicalizeSourceUrl(input1), 'https://api.example.com/search?limit=10&q=billing&sort=desc');
});

test('canonicalizeSourceUrl: handles empty and non-http schemes', () => {
  assert.strictEqual(canonicalizeSourceUrl(''), '');
  assert.strictEqual(canonicalizeSourceUrl('local://direct-content'), 'local://direct-content');
});
