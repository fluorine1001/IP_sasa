import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { palette } from '../src/ui/palette';

describe('canvas palette', () => {
  it('matches the CSS tokens', () => {
    const css = readFileSync(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
    for (const [name, hex] of Object.entries(palette)) {
      const token = '--' + name.replace(/^([a-z]+)(\d+)$/, '$1-$2');
      expect(css, token).toMatch(new RegExp(`${token}:\\s*${hex};`));
    }
  });
});
