import { rmSync } from 'node:fs';
import { join } from 'node:path';

export default function globalSetup(): void {
  // Playwright starts webServer before globalSetup, so runtime data is cleared
  // by the app webServer command. Only stale test artifacts are safe here.
  rmSync(join(process.cwd(), 'test-results'), {
    recursive: true,
    force: true,
  });
}
