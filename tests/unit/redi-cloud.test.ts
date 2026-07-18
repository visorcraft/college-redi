import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RediCloud } from '../../src/components/redi/RediCloud';
import type { RediState } from '../../src/components/redi/widgetState';

const STATES: RediState[] = [
  'idle',
  'sleepy',
  'thinking',
  'alert',
  'celebrating',
];

describe('RediCloud visual states', () => {
  it('renders the shipped SVG asset with distinct canonical state output', () => {
    const markup = STATES.map((state) =>
      renderToStaticMarkup(createElement(RediCloud, { state })));
    for (const [index, state] of STATES.entries()) {
      expect(markup[index]).toContain('src="/redi-cloud.svg"');
      expect(markup[index]).toContain(`data-redi-state="${state}"`);
    }
    expect(new Set(markup).size).toBe(STATES.length);
  });

  it('passes the widget state through without a lossy mood mapping', () => {
    const source = readFileSync('src/components/redi/RediWidget.tsx', 'utf8');
    expect(source).toContain('<RediCloud state={state} size={64} />');
    expect(source).not.toContain('moodByState');
  });
});
