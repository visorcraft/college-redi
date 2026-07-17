import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production runtime packaging', () => {
  it('copies the PDF.js worker package into the standalone image', () => {
    expect(readFileSync('Dockerfile', 'utf8')).toContain(
      'COPY --from=deps /app/node_modules/pdfjs-dist/build/pdf.worker.mjs ./.next/server/chunks/pdf.worker.mjs',
    );
  });

  it('keeps default Compose deployments on loopback', () => {
    expect(readFileSync('docker-compose.yml', 'utf8'))
      .toContain('"127.0.0.1:3000:3000"');
    expect(readFileSync('docker-compose.daemon.yml', 'utf8'))
      .toContain('HOSTNAME: 127.0.0.1');
  });
});
