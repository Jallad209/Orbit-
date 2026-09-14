import { describe, expect, it } from 'vitest';
import { classifyHref } from './markdownLinks';

const ID = '01a0a1b6-3ad4-7678-92cc-ae55e388b0a6';

describe('Markdown link policy', () => {
  it('allows http, https, and mailto without credentials', () => {
    expect(classifyHref('https://example.com/a?b=1#c')).toEqual({
      kind: 'external',
      url: 'https://example.com/a?b=1#c',
    });
    expect(classifyHref('http://example.com')).toMatchObject({ kind: 'external' });
    expect(classifyHref('mailto:someone@example.com')).toMatchObject({ kind: 'external' });
    expect(classifyHref(' https://example.com ')).toMatchObject({ kind: 'external' });
  });

  it('routes orbit:// links through the typed parser', () => {
    expect(classifyHref(`orbit://note/${ID}`)).toEqual({
      kind: 'internal',
      destination: { type: 'note', id: ID },
    });
    expect(classifyHref(`orbit://area/${ID}`)).toEqual({ kind: 'blocked' });
    expect(classifyHref('orbit://note/nope')).toEqual({ kind: 'blocked' });
  });

  it('blocks executable, local, relative, unknown, and encoded links', () => {
    const blocked = [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///C:/Users/me/secret.txt',
      '\\\\server\\share\\file',
      '//evil.example/x',
      '/relative/path',
      'relative.md',
      'ftp://example.com/x',
      'vbscript:msgbox(1)',
      'https://user:pw@example.com/',
      '%6Aavascript:alert(1)',
      'https:%2F%2Fexample.com',
      'orbit%3A%2F%2Fnote%2F' + ID,
      '',
      null,
      undefined,
      'https://' + 'a'.repeat(3000),
    ];
    for (const href of blocked)
      expect(classifyHref(href), String(href)).toEqual({ kind: 'blocked' });
  });
});
