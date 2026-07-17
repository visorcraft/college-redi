import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production runtime packaging', () => {
  it('copies the PDF.js worker package into the standalone image', () => {
    expect(readFileSync('Dockerfile', 'utf8')).toContain(
      'COPY --from=deps /app/node_modules/pdfjs-dist/build/pdf.worker.mjs ./.next/server/chunks/pdf.worker.mjs',
    );
  });
});
