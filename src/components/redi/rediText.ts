import type { RediStatusInput } from './widgetState';

const ACTIVITY_LINES: Record<string, string> = {
  check_email_now: 'Redi is checking your email…',
  list_processed_emails: 'Redi is reading your email summaries…',
  get_email_detail: 'Redi is reading that email summary…',
  get_degree_progress: 'Redi is checking your degree progress…',
  get_registration_status: 'Redi is checking your registration…',
  list_tasks: 'Redi is looking at your tasks…',
  create_task: 'Redi is adding that task…',
  complete_task: 'Redi is checking off that task…',
  update_planned_course: 'Redi is updating your registration…',
  list_notifications: 'Redi is checking your notifications…',
  schedule_notification: 'Redi is setting that reminder…',
  search_all: 'Redi is searching…',
  get_system_status: 'Redi is checking system status…',
  list_terms: 'Redi is checking your terms…',
};

export function toolActivityLine(toolName: string): string {
  return ACTIVITY_LINES[toolName]
    ?? `Redi is using ${toolName.replace(/_/g, ' ')}…`;
}

export function rediStatusLine(status: RediStatusInput): string {
  if (!status.aiConfigured) {
    return 'Redi can talk to you once you add your AI credentials and pick a model';
  }
  if (status.celebrating) return 'Nice - one more thing done!';
  if (status.chatBusy || status.jobRunning) return 'Redi is thinking…';
  if (status.unreadCount > 0) {
    return `${status.unreadCount} thing${status.unreadCount === 1 ? '' : 's'} need${
      status.unreadCount === 1 ? 's' : ''
    } you today`;
  }
  return 'Ask Redi anything';
}
