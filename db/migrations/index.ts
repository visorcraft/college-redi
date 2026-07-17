import type { Migration } from '@visorcraft/mongreldb-kit';
import { init } from './0001_init';

export const migrations: Migration[] = [init];
