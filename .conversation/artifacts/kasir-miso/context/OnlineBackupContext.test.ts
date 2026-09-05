import { describe, expect, it } from 'vitest';
import {
  accountMetadataKey,
  isBackupDataKey,
  isBackupMetadataKey,
  LAST_BACKUP_KEY,
  REMOTE_REVISION_KEY,
} from './onlineBackupMetadata';

describe('online backup account metadata', () => {
  it('normalizes and scopes metadata to each verified Google email', () => {
    expect(accountMetadataKey(LAST_BACKUP_KEY, ' Owner-A@Example.com ')).toBe(
      `${LAST_BACKUP_KEY}:owner-a%40example.com`,
    );
    expect(accountMetadataKey(LAST_BACKUP_KEY, 'owner-b@example.com')).not.toBe(
      accountMetadataKey(LAST_BACKUP_KEY, 'owner-a@example.com'),
    );
    expect(accountMetadataKey(REMOTE_REVISION_KEY, 'owner-a@example.com')).not.toBe(
      accountMetadataKey(REMOTE_REVISION_KEY, 'owner-b@example.com'),
    );
  });

  it('never puts account metadata in the business-data backup payload', () => {
    expect(isBackupDataKey('warung-state-v2')).toBe(true);
    expect(isBackupDataKey(accountMetadataKey(LAST_BACKUP_KEY, 'owner-a@example.com'))).toBe(false);
    expect(isBackupDataKey(accountMetadataKey(REMOTE_REVISION_KEY, 'owner-a@example.com'))).toBe(false);
    expect(isBackupMetadataKey(accountMetadataKey(LAST_BACKUP_KEY, 'owner-a@example.com'))).toBe(true);
    expect(isBackupMetadataKey(accountMetadataKey(REMOTE_REVISION_KEY, 'owner-a@example.com'))).toBe(true);
  });
});