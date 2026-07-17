import { registerSystemTools } from './system';
import { registerSettingsTools } from './settings';
import { connectionTestTools } from './connectionTests';
import { degreeTools } from './degree';
import { termsTools } from './terms';
import { taskTools } from './tasks';
import { notificationTools } from './notifications';
import { registerTool, type Tool } from './registry';

const globalState = globalThis as typeof globalThis & { __rediToolsRegistered?: boolean };

export function registerAllTools(): void {
  if (globalState.__rediToolsRegistered) return;
  registerSystemTools();
  registerSettingsTools();
  for (const tool of connectionTestTools) registerTool(tool as Tool);
  for (const tool of [...degreeTools, ...termsTools, ...taskTools, ...notificationTools]) registerTool(tool);
  globalState.__rediToolsRegistered = true;
}

export function _resetToolsForTests(): void {
  delete globalState.__rediToolsRegistered;
}
