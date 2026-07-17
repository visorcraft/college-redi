import type { Migration } from '@visorcraft/mongreldb-kit';
import { init } from './0001_init';
import { notificationsReadAt } from './0002_notifications_read_at';

export const migrations: Migration[] = [init, notificationsReadAt];
