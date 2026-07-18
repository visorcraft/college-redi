# Redi privacy

Redi is a self-hosted, single-user application. It stores settings, degree plans,
tasks, processed email metadata and summaries, notifications, chat history, audit
records, and job state in the configured MongrelDB database. Passwords, provider
keys, email credentials, and MCP token hashes are stored separately from ordinary
records. Redi does not include analytics or advertising trackers.

Data remains until the user changes or deletes it. Settings > Security can export
all user records as JSON. Secret values and MCP token hashes are never exported.
The same page can permanently reset the database after password verification and
an exact confirmation phrase. Files in external backup systems are outside Redi
and must be removed through those systems.
