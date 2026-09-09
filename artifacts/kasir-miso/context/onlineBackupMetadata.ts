export const GOOGLE_SESSION_TOKEN_KEY = 'warung-google-server-session-v1';
export const LAST_BACKUP_KEY = 'warung-online-backup-last-v1';
export const REMOTE_REVISION_KEY = 'warung-online-backup-remote-revision-v1';
export const NOTES_STORAGE_KEY = 'kasir-miso-notes-v1';
const RECOVERY_SNAPSHOT_KEY = 'warung-online-restore-recovery-v1';
const RECOVERY_JOURNAL_KEY = 'warung-online-restore-journal-v1';

const EXCLUDED_BACKUP_KEYS = new Set([
  'warung-google-connection-v1',
  'warung-google-account-email-v1',
  GOOGLE_SESSION_TOKEN_KEY,
  'warung-offline-backup-v1',
  LAST_BACKUP_KEY,
  RECOVERY_SNAPSHOT_KEY,
  RECOVERY_JOURNAL_KEY,
  REMOTE_REVISION_KEY,
]);

export const accountMetadataKey = (key: string, accountEmail: string) => (
  accountEmail.trim()
    ? `${key}:${encodeURIComponent(accountEmail.trim().toLowerCase())}`
    : key
);

export const isBackupMetadataKey = (key: string) => (
  EXCLUDED_BACKUP_KEYS.has(key)
  || key.startsWith(`${LAST_BACKUP_KEY}:`)
  || key.startsWith(`${REMOTE_REVISION_KEY}:`)
);

export const isBackupDataKey = (key: string) => (
  (key.startsWith('warung-') || key === NOTES_STORAGE_KEY) && !isBackupMetadataKey(key)
);