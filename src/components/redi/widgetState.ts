export type WidgetState = 'sleepy' | 'idle';

// Spec §6.6 sleepy-gate message — verbatim.
export const SLEEPY_MESSAGE = 'Redi can talk to you once you add your AI credentials and pick a model';

export function getWidgetState(input: { aiConfigured: boolean }): WidgetState {
  return input.aiConfigured ? 'idle' : 'sleepy';
}

export function getTooltip(state: WidgetState): string {
  return state === 'sleepy'
    ? 'Redi is sleepy — add your AI key to wake him up'
    : 'Redi is here if you need him';
}
