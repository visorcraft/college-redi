import { timestamp, type Migration } from '@visorcraft/mongreldb-kit';

export const notificationsReadAt: Migration = {
  version: 2,
  name: 'notifications_read_at',
  ops: [{ kind: 'addColumn', table: 'notifications', column: 'read_at' }],
  up({ addColumn }) {
    addColumn('notifications', timestamp('read_at', { nullable: true }));
  },
};

export default notificationsReadAt;
