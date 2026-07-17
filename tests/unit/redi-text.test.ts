import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdownLite } from '../../src/components/redi/markdownLite';
import {
  rediStatusLine,
  toolActivityLine,
} from '../../src/components/redi/rediText';

const status = (
  over: Partial<Parameters<typeof rediStatusLine>[0]> = {},
) => rediStatusLine({
  aiConfigured: true,
  unreadCount: 0,
  chatBusy: false,
  jobRunning: false,
  celebrating: false,
  ...over,
});

describe('renderMarkdownLite', () => {
  it('renders formatting without raw HTML injection', () => {
    const html = renderToStaticMarkup(renderMarkdownLite(
      '**On track** for `CS 201`\n- one\n- two\n<script>alert(1)</script>',
    ));
    expect(html).toContain('<strong>On track</strong>');
    expect(html).toContain('CS 201');
    expect((html.match(/<li>/g) ?? [])).toHaveLength(2);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('toolActivityLine', () => {
  it('maps known tools and formats unknown names', () => {
    expect(toolActivityLine('check_email_now'))
      .toBe('Redi is checking your email…');
    expect(toolActivityLine('get_degree_progress'))
      .toBe('Redi is checking your degree progress…');
    expect(toolActivityLine('some_new_tool'))
      .toBe('Redi is using some new tool…');
  });
});

describe('rediStatusLine', () => {
  it('reflects each widget state', () => {
    expect(status({ aiConfigured: false })).toBe(
      'Redi can talk to you once you add your AI credentials and pick a model',
    );
    expect(status({ unreadCount: 3 })).toBe('3 things need you today');
    expect(status({ unreadCount: 1 })).toBe('1 thing needs you today');
    expect(status({ chatBusy: true })).toBe('Redi is thinking…');
    expect(status()).toBe('Ask Redi anything');
  });
});
