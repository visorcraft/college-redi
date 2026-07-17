import { registerSystemTools } from './system';
import { registerSettingsTools } from './settings';

const globalState = globalThis as typeof globalThis & { __rediToolsRegistered?: boolean };

export function registerAllTools(): void {
  if (globalState.__rediToolsRegistered) return;
  registerSystemTools();
  registerSettingsTools();
  globalState.__rediToolsRegistered = true;
}

export function _resetToolsForTests(): void {
  delete globalState.__rediToolsRegistered;
}
