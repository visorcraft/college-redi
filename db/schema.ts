import {
  Schema, table, int, text, real, bool, json, timestamp, date, blob,
  index, unique, foreignKey, staticDefault,
} from '@visorcraft/mongreldb-kit';

// ---------- §7.1 Configuration & secrets ----------

export const appSettings = table('app_settings', {
  columns: [
    int('id', { primaryKey: true }),
    json('payload'),
    timestamp('updated_at'),
  ],
  primaryKey: 'id',
});

export const secrets = table('secrets', {
  columns: [
    text('name', { primaryKey: true }),
    blob('ciphertext'),
    timestamp('created_at'),
    timestamp('rotated_at'),
  ],
  primaryKey: 'name',
});

export const mcpTokens = table('mcp_tokens', {
  columns: [
    text('id', { primaryKey: true }),
    text('name'),
    text('token_hash'),
    timestamp('created_at'),
    timestamp('last_used_at', { nullable: true }),
    timestamp('revoked_at', { nullable: true }),
  ],
  primaryKey: 'id',
});

// ---------- §7.2 Degree domain ----------

export const degreePrograms = table('degree_programs', {
  columns: [
    text('id', { primaryKey: true }),
    text('name'), text('institution'), text('catalog_year'),
    int('total_credits_required'),
    real('gpa_requirement', { nullable: true }),
    text('status', { enumValues: ['active', 'completed', 'abandoned'], default: staticDefault('active') }),
    text('source', { enumValues: ['import', 'manual'], default: staticDefault('manual') }),
    timestamp('created_at'), timestamp('updated_at'),
  ],
  primaryKey: 'id',
});

export const courses = table('courses', {
  columns: [
    text('id', { primaryKey: true }),
    text('program_id'), text('code'), text('title'),
    int('credits'),
    text('description', { nullable: true }),
    json('prerequisites', { default: staticDefault('[]') }),
    json('typical_terms', { default: staticDefault('[]') }),
    text('subject'),
  ],
  primaryKey: 'id',
  unique: [unique(['program_id', 'code'])],
  foreignKeys: [foreignKey(['program_id'], { table: 'degree_programs', columns: ['id'] }, { onDelete: 'cascade' })],
});

export const requirements = table('requirements', {
  columns: [
    text('id', { primaryKey: true }),
    text('program_id'),
    text('type', { enumValues: ['course', 'credit_bucket', 'gpa', 'milestone'] }),
    text('course_id', { nullable: true }),
    int('credits_required', { nullable: true }),
    text('min_grade', { nullable: true }),
    json('bucket_rule', { nullable: true }),
    text('group_name'), text('description'),
    int('sort_order'),
  ],
  primaryKey: 'id',
  foreignKeys: [
    foreignKey(['program_id'], { table: 'degree_programs', columns: ['id'] }, { onDelete: 'cascade' }),
    foreignKey(['course_id'], { table: 'courses', columns: ['id'] }, { onDelete: 'set null' }),
  ],
});

export const completedCourses = table('completed_courses', {
  columns: [
    text('id', { primaryKey: true }),
    text('program_id'), text('course_id'),
    text('term'), int('year'),
    text('grade', { nullable: true }),
    int('credits'),
    text('status', { enumValues: ['completed', 'in_progress', 'transfer'] }),
    text('source', { enumValues: ['manual', 'import', 'email'], default: staticDefault('manual') }),
    timestamp('created_at'),
  ],
  primaryKey: 'id',
  unique: [unique(['program_id', 'course_id', 'term', 'year'])],
  foreignKeys: [
    foreignKey(['program_id'], { table: 'degree_programs', columns: ['id'] }, { onDelete: 'cascade' }),
    foreignKey(['course_id'], { table: 'courses', columns: ['id'] }, { onDelete: 'restrict' }),
  ],
});

export const terms = table('terms', {
  columns: [
    text('id', { primaryKey: true }),
    text('name'),
    date('classes_start'), date('classes_end'),
    timestamp('registration_opens_at', { nullable: true }),
    timestamp('registration_closes_at', { nullable: true }),
    timestamp('add_drop_deadline', { nullable: true }),
    timestamp('tuition_due', { nullable: true }),
    text('notes', { nullable: true }),
  ],
  primaryKey: 'id',
  unique: [unique(['name'])],
});

export const plannedCourses = table('planned_courses', {
  columns: [
    text('id', { primaryKey: true }),
    text('program_id'), text('course_id'), text('term_id'),
    text('status', { enumValues: ['planned', 'registered', 'waitlisted', 'dropped', 'completed'], default: staticDefault('planned') }),
    text('section', { nullable: true }),
    text('notes', { nullable: true }),
    timestamp('created_at'), timestamp('updated_at'),
  ],
  primaryKey: 'id',
  unique: [unique(['program_id', 'course_id', 'term_id'])],
  foreignKeys: [
    foreignKey(['program_id'], { table: 'degree_programs', columns: ['id'] }, { onDelete: 'cascade' }),
    foreignKey(['course_id'], { table: 'courses', columns: ['id'] }, { onDelete: 'restrict' }),
    foreignKey(['term_id'], { table: 'terms', columns: ['id'] }, { onDelete: 'cascade' }),
  ],
});

// ---------- §7.3 Tasks & events ----------

export const tasks = table('tasks', {
  columns: [
    text('id', { primaryKey: true }),
    text('title'),
    text('description', { nullable: true }),
    text('category', { enumValues: ['transcript', 'vaccine', 'financial_aid', 'housing', 'advising', 'registration', 'payment', 'other'], default: staticDefault('other') }),
    text('status', { enumValues: ['pending', 'awaiting_confirmation', 'completed', 'dismissed'], default: staticDefault('pending') }),
    timestamp('due_at', { nullable: true }),
    json('reminder_policy', { nullable: true }),
    text('source', { enumValues: ['wizard', 'manual', 'email', 'redi', 'mcp', 'system'], default: staticDefault('manual') }),
    text('source_email_id', { nullable: true }),
    timestamp('created_at'), timestamp('updated_at'),
    timestamp('completed_at', { nullable: true }),
  ],
  primaryKey: 'id',
  foreignKeys: [foreignKey(['source_email_id'], { table: 'emails_processed', columns: ['id'] }, { onDelete: 'set null' })],
});

export const extractedEvents = table('extracted_events', {
  columns: [
    text('id', { primaryKey: true }),
    text('email_id'),
    text('title'),
    text('event_type', { enumValues: ['deadline', 'registration', 'appointment', 'payment', 'general'], default: staticDefault('general') }),
    timestamp('due_at', { nullable: true }),
    real('confidence'),
    text('status', { enumValues: ['pending_review', 'accepted', 'dismissed'], default: staticDefault('pending_review') }),
    text('task_id', { nullable: true }),
    timestamp('created_at'),
  ],
  primaryKey: 'id',
  foreignKeys: [
    foreignKey(['email_id'], { table: 'emails_processed', columns: ['id'] }, { onDelete: 'cascade' }),
    foreignKey(['task_id'], { table: 'tasks', columns: ['id'] }, { onDelete: 'set null' }),
  ],
});

// ---------- §7.4 Email pipeline ----------

export const emailsProcessed = table('emails_processed', {
  columns: [
    text('id', { primaryKey: true }),
    text('mailbox'), int('uid'), int('uidvalidity'),
    text('message_id'), text('from_addr'), text('subject'),
    timestamp('received_at'),
    text('classification', { enumValues: ['junk', 'informational', 'actionable', 'unprocessed'], default: staticDefault('unprocessed') }),
    text('summary', { nullable: true }),
    int('extracted_count'),
    bool('notified', { default: staticDefault(false) }),
    timestamp('processed_at', { nullable: true }),
  ],
  primaryKey: 'id',
  unique: [unique(['mailbox', 'uidvalidity', 'uid'])],
  indexes: [index(['message_id'])],
});

export const senderRules = table('sender_rules', {
  columns: [
    text('id', { primaryKey: true }),
    text('pattern'),
    text('action', { enumValues: ['junk', 'important'] }),
    timestamp('created_at'),
  ],
  primaryKey: 'id',
});

// ---------- §7.5 Notifications ----------

export const notifications = table('notifications', {
  columns: [
    text('id', { primaryKey: true }),
    text('type'), text('title'), text('body'),
    text('importance', { enumValues: ['low', 'normal', 'urgent'], default: staticDefault('normal') }),
    json('channels'),
    timestamp('scheduled_for'),
    text('status', { enumValues: ['pending', 'sent', 'failed', 'cancelled'], default: staticDefault('pending') }),
    text('related_type', { nullable: true }),
    text('related_id', { nullable: true }),
    timestamp('created_at'),
    timestamp('sent_at', { nullable: true }),
    timestamp('read_at', { nullable: true }),
  ],
  primaryKey: 'id',
  indexes: [index(['status', 'scheduled_for'])],
});

export const notificationHistory = table('notification_history', {
  columns: [
    text('id', { primaryKey: true }),
    text('notification_id'),
    text('channel'), text('destination'),
    text('status', { enumValues: ['sent', 'failed'] }),
    json('provider_response', { nullable: true }),
    int('attempt'),
    timestamp('sent_at'),
  ],
  primaryKey: 'id',
  foreignKeys: [foreignKey(['notification_id'], { table: 'notifications', columns: ['id'] }, { onDelete: 'cascade' })],
});

// ---------- §7.6 Chat, audit, jobs ----------

export const chatConversations = table('chat_conversations', {
  columns: [
    text('id', { primaryKey: true }),
    text('title'),
    timestamp('created_at'), timestamp('updated_at'),
  ],
  primaryKey: 'id',
});

export const chatMessages = table('chat_messages', {
  columns: [
    text('id', { primaryKey: true }),
    text('conversation_id'),
    text('role', { enumValues: ['user', 'assistant', 'tool'] }),
    text('content'),
    json('tool_calls', { nullable: true }),
    timestamp('created_at'),
  ],
  primaryKey: 'id',
  indexes: [index(['conversation_id', 'created_at'])],
  foreignKeys: [foreignKey(['conversation_id'], { table: 'chat_conversations', columns: ['id'] }, { onDelete: 'cascade' })],
});

export const auditLog = table('audit_log', {
  columns: [
    text('id', { primaryKey: true }),
    text('actor'), text('tool_name'),
    text('entity_type', { nullable: true }),
    text('entity_id', { nullable: true }),
    json('detail', { nullable: true }),
    timestamp('created_at'),
  ],
  primaryKey: 'id',
  indexes: [index(['created_at'])],
});

export const jobLeases = table('job_leases', {
  columns: [
    text('job_name', { primaryKey: true }),
    timestamp('locked_until'),
    timestamp('last_run_at'),
    text('last_status'),
  ],
  primaryKey: 'job_name',
});

export const ALL_TABLES = [
  appSettings, secrets, mcpTokens,
  degreePrograms, courses, requirements, completedCourses, terms, plannedCourses,
  tasks, extractedEvents,
  emailsProcessed, senderRules,
  notifications, notificationHistory,
  chatConversations, chatMessages, auditLog, jobLeases,
];

export const schema = new Schema(ALL_TABLES);
