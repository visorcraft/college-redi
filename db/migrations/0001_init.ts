import type { Migration } from '@visorcraft/mongreldb-kit';
import {
  appSettings, secrets, mcpTokens,
  degreePrograms, courses, requirements, completedCourses, terms, plannedCourses,
  tasks, extractedEvents,
  emailsProcessed, senderRules,
  notifications, notificationHistory,
  chatConversations, chatMessages, auditLog, jobLeases,
} from '../schema';

const TABLES = [
  appSettings, secrets, mcpTokens,
  degreePrograms, courses, requirements, completedCourses, terms, plannedCourses,
  tasks, extractedEvents,
  emailsProcessed, senderRules,
  notifications, notificationHistory,
  chatConversations, chatMessages, auditLog, jobLeases,
];

export const init: Migration = {
  version: 1,
  name: 'init',
  ops: TABLES.map((t) => ({ kind: 'createTable' as const, name: t.name })),
  up({ ensureTable }) {
    for (const t of TABLES) ensureTable(t);
  },
};
