import { ensureBootstrapped } from './server/bootstrap';

export function register(): Promise<void> {
  return ensureBootstrapped();
}
