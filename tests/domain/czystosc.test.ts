/**
 * Strażnik warstwy domeny (DECYZJE §1): brak React, DOM, IndexedDB, Date.now(), Math.random()
 * i bezargumentowego new Date(). Dodatkowo tsconfig.domain.json kompiluje domenę bez lib DOM i typów Node.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const domainDir = fileURLToPath(new URL('../../src/domain', import.meta.url));

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return listTs(p);
    return e.name.endsWith('.ts') ? [p] : [];
  });
}

/** Usuwa komentarze, aby dokumentacja mogła wymieniać zakazane API. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FORBIDDEN: [RegExp, string][] = [
  [/\bDate\.now\s*\(/, 'Date.now()'],
  [/\bnew\s+Date\s*\(\s*\)/, 'new Date() bez argumentu'],
  [/\bMath\.random\s*\(/, 'Math.random()'],
  [/\bperformance\.now\s*\(/, 'performance.now()'],
  [/\bfrom\s+['"]react/, 'import React'],
  [/\bindexedDB\b|\bIDB[A-Z]\w*/, 'IndexedDB'],
  [/\b(window|document|localStorage|sessionStorage|navigator)\b/, 'DOM/BOM'],
  [/\brandomUUID\b|\bgetRandomValues\b/, 'losowe identyfikatory (dostarcza kontroler)'],
  [/\bfrom\s+['"](\.\.\/)+(app|ui|persistence|pwa)\b/, 'import z warstwy wyższej'],
  [/\bfrom\s+['"]node:/, 'moduły Node'],
];

describe('czystość src/domain', () => {
  const files = listTs(domainDir);

  it('zawiera pliki źródłowe', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(domainDir.length + 1), f]))('%s nie używa zakazanych API', (_name, file) => {
    const code = stripComments(readFileSync(file, 'utf-8'));
    const hits = FORBIDDEN.filter(([re]) => re.test(code)).map(([, label]) => label);
    expect(hits).toEqual([]);
  });
});
