import React from 'react';

/** Render safe chat formatting without accepting raw HTML. */
export function renderMarkdownLite(text: string): React.ReactNode {
  text = text.replace(/<!-- redi-confirm:[\s\S]*?(?:-->|$)/g, '').trimEnd();
  text = text.replace(
    /Confirm this exact (destructive|sensitive) action\?\n([a-z_]+) [^\n]+\nReply yes to confirm\. Anything else cancels it\./g,
    (_, kind: string, tool: string) => (
      tool === 'delete_task'
        ? 'Delete this task permanently?'
        : 'Continue with this ' + (kind === 'destructive' ? 'permanent' : 'sensitive') + ' action?'
    ) + '\n\nReply yes to confirm. Anything else cancels it.',
  );
  const blocks: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key} className="my-1 list-disc pl-5">
        {bullets}
      </ul>,
    );
    bullets = [];
  };

  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      bullets.push(
        <li key={`li-${index}`}>{renderInline(trimmed.slice(2))}</li>,
      );
      return;
    }
    flushBullets(`ul-${index}`);
    if (trimmed === '') {
      blocks.push(
        <div key={`sp-${index}`} className="h-2" aria-hidden="true" />,
      );
      return;
    }
    blocks.push(
      <p key={`p-${index}`} className="my-0.5">
        {renderInline(line)}
      </p>,
    );
  });
  flushBullets('ul-end');
  return <>{blocks}</>;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  const pattern = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/;
  while (rest.length > 0) {
    const match = pattern.exec(rest);
    if (!match) {
      parts.push(rest);
      break;
    }
    if (match.index > 0) parts.push(rest.slice(0, match.index));
    if (match[2] != null) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[4] != null) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em]"
        >
          {match[4]}
        </code>,
      );
    } else if (match[6] != null) {
      parts.push(<em key={key++}>{match[6]}</em>);
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return parts;
}
