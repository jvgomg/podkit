import { describe, expect, it } from 'bun:test';
import { DOCS_BASE_URL, DOCS_URLS, docsUrl } from './docs-urls';

describe('DOCS_URLS', () => {
  it('every entry ends with a trailing slash', () => {
    for (const [key, url] of Object.entries(DOCS_URLS)) {
      expect(url, `DOCS_URLS.${key} must end with '/'`).toMatch(/\/$/);
    }
  });

  it('every entry is rooted at DOCS_BASE_URL', () => {
    for (const [key, url] of Object.entries(DOCS_URLS)) {
      expect(url, `DOCS_URLS.${key} must start with DOCS_BASE_URL`).toStartWith(DOCS_BASE_URL);
    }
  });
});

describe('docsUrl', () => {
  it('appends a trailing slash when missing', () => {
    expect(docsUrl('foo/bar')).toBe(`${DOCS_BASE_URL}/foo/bar/`);
  });

  it('preserves an existing trailing slash', () => {
    expect(docsUrl('foo/bar/')).toBe(`${DOCS_BASE_URL}/foo/bar/`);
  });

  it('normalizes a leading slash', () => {
    expect(docsUrl('/foo/bar')).toBe(`${DOCS_BASE_URL}/foo/bar/`);
  });
});
