// Widget state priority: sleepy > celebrating > thinking > alert > idle.
export type RediState = 'sleepy' | 'idle' | 'thinking' | 'alert' | 'celebrating';
export type WidgetState = RediState;

// Spec §6.6 sleepy-gate message — verbatim.
export const SLEEPY_MESSAGE = 'Redi can talk to you once you add your AI credentials and pick a model';

export interface RediStatusInput {
  aiConfigured: boolean;
  unreadCount: number;
  chatBusy: boolean;
  jobRunning: boolean;
  celebrating: boolean;
}

export function deriveRediState(status: RediStatusInput): RediState {
  if (!status.aiConfigured) return 'sleepy';
  if (status.celebrating) return 'celebrating';
  if (status.chatBusy || status.jobRunning) return 'thinking';
  if (status.unreadCount > 0) return 'alert';
  return 'idle';
}

// Kept for the Phase 2 shell contract.
export function getWidgetState(input: { aiConfigured: boolean }): WidgetState {
  return deriveRediState({
    ...input,
    unreadCount: 0,
    chatBusy: false,
    jobRunning: false,
    celebrating: false,
  });
}

export function getTooltip(state: WidgetState): string {
  if (state === 'sleepy') return 'Redi is sleepy — add your AI key to wake him up';
  if (state === 'thinking') return 'Redi is thinking…';
  if (state === 'alert') return 'You have unread updates';
  if (state === 'celebrating') return 'Nice — one more thing done!';
  return 'Redi is here if you need him';
}
