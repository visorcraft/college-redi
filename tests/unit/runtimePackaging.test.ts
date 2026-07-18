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

  it('ships Redi as SVG and Lottie assets', () => {
    expect(readFileSync('public/redi-cloud.svg', 'utf8')).toContain('#1F2D50');
    const middleware = readFileSync('src/middleware.ts', 'utf8');
    expect(middleware).toContain('redi-cloud.svg');
    expect(middleware).toContain('redi-cloud.lottie.json');
    const lottie = JSON.parse(
      readFileSync('public/redi-cloud.lottie.json', 'utf8'),
    ) as {
      markers: Array<{ tm: number; cm: string }>;
      layers: Array<{
        nm: string;
        ks: { s: { k: Array<{ t: number; s: number[] }> } };
      }>;
    };
    expect(lottie.markers.map(({ cm }) => cm)).toEqual([
      'idle',
      'sleepy',
      'thinking',
      'alert',
      'celebrating',
    ]);
    const scaleFrames = lottie.layers.find(({ nm }) => nm === 'Redi')?.ks.s.k;
    const stateScales = lottie.markers.map(({ tm }) =>
      scaleFrames?.find(({ t }) => t === tm)?.s[0]);
    expect(stateScales.every((scale) => typeof scale === 'number')).toBe(true);
    expect(new Set(stateScales).size).toBe(5);
  });

  it('closes MongrelDB after Next drains active requests', () => {
    const client = readFileSync('src/server/db/client.ts', 'utf8');
    expect(client).toContain("process.once('exit', close)");
    expect(client).not.toContain("process.once('SIGTERM'");
    expect(client).not.toContain("process.once('SIGINT'");
  });
});
