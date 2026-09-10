import React from 'react';
import { createHash, randomUUID } from 'node:crypto';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@workspace/api-client-react';
import {
  createStoredBackup,
  type StoredBackup,
} from '@/utils/backupEnvelope';
import {
  accountMetadataKey,
  isBackupDataKey,
  isBackupMetadataKey,
  LAST_BACKUP_KEY,
  NOTES_STORAGE_KEY,
  REMOTE_REVISION_KEY,
} from './onlineBackupMetadata';
import { OnlineBackupProvider, useOnlineBackup } from './OnlineBackupContext';

const testState = vi.hoisted(() => {
  const data = new Map<string, string>();
  let failOnceKey: string | null = null;

  const getAllKeys = vi.fn(async () => [...data.keys()]);
  const getItem = vi.fn(async (key: string) => data.get(key) ?? null);
  const setItem = vi.fn(async (key: string, value: string) => {
    data.set(key, value);
  });
  const removeItem = vi.fn(async (key: string) => {
    data.delete(key);
  });
  const multiGet = vi.fn(async (keys: string[]) => (
    keys.map((key) => [key, data.get(key) ?? null] as [string, string | null])
  ));
  const multiSet = vi.fn(async (entries: [string, string][]) => {
    for (const [key, value] of entries) {
      data.set(key, value);
      if (key === failOnceKey) {
        failOnceKey = null;
        throw new Error(`Gagal menulis ${key}`);
      }
    }
  });
  const multiRemove = vi.fn(async (keys: string[]) => {
    keys.forEach((key) => data.delete(key));
  });

  return {
    data,
    getAllKeys,
    getItem,
    setItem,
    removeItem,
    multiGet,
    multiSet,
    multiRemove,
    failOnce: (key: string | null) => {
      failOnceKey = key;
    },
  };
});


const googleAccountState = vi.hoisted(() => ({
  email: 'owner@example.com',
  connectionGeneration: 0,
  hasDriveAccess: true,
  downloadDriveBackup: vi.fn(),
  uploadDriveBackup: vi.fn(),
}));

vi.mock('expo', () => ({
  reloadAppAsync: vi.fn(),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => (
    createHash('sha256').update(value).digest('hex')
  ),
  randomUUID,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: testState.getAllKeys,
    getItem: testState.getItem,
    setItem: testState.setItem,
    removeItem: testState.removeItem,
    multiGet: testState.multiGet,
    multiSet: testState.multiSet,
    multiRemove: testState.multiRemove,
  },
}));

vi.mock('@/context/GoogleAccountContext', () => ({
  useGoogleAccount: () => googleAccountState,
}));

vi.mock('@/context/NotesContext', () => ({
  useNotes: () => ({
    hydrated: true,
    notes: {
      shoppingToday: [],
      shoppingTomorrow: [],
      carry: [],
      general: [],
    },
  }),
}));

vi.mock('@/context/WarungContext', () => ({
  useWarung: () => ({
    hydrated: true,
    menus: [],
    activeOrders: [],
    kitchenOrders: [],
    inventory: [],
    consignments: [],
    expenses: [],
    sales: [],
    savingsRules: [],
    savingsEntries: [],
    qrisImageUri: undefined,
  }),
}));

function BackupProbe() {
  const backup = useOnlineBackup();
  return React.createElement('BackupProbe', {
    testID: 'backup-probe',
    ...backup,
  });
}

function renderBackup() {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      React.createElement(
        OnlineBackupProvider,
        null,
        React.createElement(BackupProbe),
      ),
    );
  });
  return renderer;
}

async function settleEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function probe(renderer: ReactTestRenderer) {
  return renderer.root.findByProps({ testID: 'backup-probe' }).props as {
    status: string;
    lastBackupAt: string;
    error: string;
    accountRestoreStatus: string;
    restoreLatest: () => Promise<string>;
  };
}

async function makeBackup(storage: Record<string, string>) {
  return createStoredBackup(storage);
}

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
    expect(isBackupDataKey(NOTES_STORAGE_KEY)).toBe(true);
    expect(isBackupDataKey(accountMetadataKey(LAST_BACKUP_KEY, 'owner-a@example.com'))).toBe(false);
    expect(isBackupDataKey(accountMetadataKey(REMOTE_REVISION_KEY, 'owner-a@example.com'))).toBe(false);
    expect(isBackupMetadataKey(accountMetadataKey(LAST_BACKUP_KEY, 'owner-a@example.com'))).toBe(true);
    expect(isBackupMetadataKey(accountMetadataKey(REMOTE_REVISION_KEY, 'owner-a@example.com'))).toBe(true);
  });
});

describe('OnlineBackupProvider restoreLatest', () => {
  beforeEach(() => {
    testState.data.clear();
    testState.failOnce(null);
    googleAccountState.connectionGeneration = 0;
    googleAccountState.downloadDriveBackup.mockReset();
    googleAccountState.uploadDriveBackup.mockReset();
  });

  it('restores the original state and metadata after a replacement write fails', async () => {
    const lastBackupKey = accountMetadataKey(LAST_BACKUP_KEY, googleAccountState.email);
    const remoteRevisionKey = accountMetadataKey(REMOTE_REVISION_KEY, googleAccountState.email);
    const originalState = JSON.stringify({
      menus: [],
      activeOrders: [],
      kitchenOrders: [],
      inventory: [{ id: 'beras', name: 'Beras', unit: 'kg', qty: 4, safe: 1 }],
      consignments: [],
      expenses: [{
        id: 'expense-old',
        title: 'Belanja lama',
        amount: 10_000,
        date: '2026-09-09',
        shoppingItemId: 'shopping-old',
      }],
      sales: [],
      savingsRules: [],
      savingsEntries: [],
    });
    const originalReminders = JSON.stringify([{ id: 'reminder-old', title: 'Cek stok' }]);
    const originalLastBackupAt = '2026-09-09T08:00:00.000Z';
    const originalRemoteRevision = JSON.stringify({
      modifiedTime: '2026-09-09T08:00:00.000Z',
      backupId: 'backup-old',
      createdAt: originalLastBackupAt,
      payloadChecksum: 'checksum-old',
    });
    testState.data.set('warung-state-v2', originalState);
    testState.data.set('warung-reminders-v1', originalReminders);
    testState.data.set(lastBackupKey, originalLastBackupAt);
    testState.data.set(remoteRevisionKey, originalRemoteRevision);

    const incoming = await makeBackup({
      'warung-state-v2': JSON.stringify({
        menus: [],
        activeOrders: [],
        kitchenOrders: [],
        inventory: [],
        consignments: [],
        expenses: [{
          id: 'expense-new',
          title: 'Belanja baru',
          amount: 25_000,
          date: '2026-09-10',
          shoppingItemId: 'shopping-new',
        }],
        sales: [],
        savingsRules: [],
        savingsEntries: [],
      }),
      'warung-reminders-v1': JSON.stringify([{ id: 'reminder-new', title: 'Beli minyak' }]),
    });
    googleAccountState.downloadDriveBackup.mockResolvedValue({
      content: JSON.stringify(incoming),
      modifiedTime: '2026-09-10T08:00:00.000Z',
    });
    testState.failOnce('warung-reminders-v1');

    const renderer = renderBackup();
    await act(async () => {
      await expect(probe(renderer).restoreLatest()).rejects.toThrow('Gagal menulis warung-reminders-v1');
    });

    expect(testState.data.get('warung-state-v2')).toBe(originalState);
    expect(testState.data.get('warung-reminders-v1')).toBe(originalReminders);
    expect(testState.data.get(lastBackupKey)).toBe(originalLastBackupAt);
    expect(testState.data.get(remoteRevisionKey)).toBe(originalRemoteRevision);
    expect(probe(renderer)).toMatchObject({
      status: 'error',
      error: 'Gagal menulis warung-reminders-v1',
    });
  });

  it('restores shopping expense identity and records the remote revision on success', async () => {
    const lastBackupKey = accountMetadataKey(LAST_BACKUP_KEY, googleAccountState.email);
    const remoteRevisionKey = accountMetadataKey(REMOTE_REVISION_KEY, googleAccountState.email);
    testState.data.set('warung-state-v2', JSON.stringify({
      menus: [],
      activeOrders: [],
      kitchenOrders: [],
      inventory: [],
      consignments: [],
      expenses: [],
      sales: [],
      savingsRules: [],
      savingsEntries: [],
    }));
    testState.data.set(lastBackupKey, '2026-09-09T08:00:00.000Z');

    const incoming = await makeBackup({
      'warung-state-v2': JSON.stringify({
        menus: [],
        activeOrders: [],
        kitchenOrders: [],
        inventory: [],
        consignments: [],
        expenses: [{
          id: 'expense-shopping',
          title: 'Belanja hari ini · Minyak',
          amount: 25_000,
          date: '2026-09-10',
          shoppingItemId: 'shopping-1',
        }],
        sales: [],
        savingsRules: [],
        savingsEntries: [],
      }),
      [NOTES_STORAGE_KEY]: JSON.stringify({
        shoppingToday: [{
          id: 'shopping-1',
          text: 'Minyak',
          done: true,
          createdAt: '2026-09-10T07:00:00.000Z',
          quantity: 2,
          unit: 'liter',
          price: 25_000,
          expenseRecorded: true,
        }],
        shoppingTomorrow: [],
        carry: [],
        general: [],
        shoppingTomorrowDate: '2026-09-11',
      }),
    });
    googleAccountState.downloadDriveBackup.mockResolvedValue({
      content: JSON.stringify(incoming),
      modifiedTime: '2026-09-10T08:30:00.000Z',
    });

    const renderer = renderBackup();
    let restoredAt = '';
    await act(async () => {
      restoredAt = await probe(renderer).restoreLatest();
    });

    expect(restoredAt).toBe(incoming.createdAt);
    expect(JSON.parse(testState.data.get('warung-state-v2')!)).toMatchObject({
      expenses: [{ shoppingItemId: 'shopping-1' }],
    });
    expect(JSON.parse(testState.data.get(NOTES_STORAGE_KEY)!)).toMatchObject({
      shoppingToday: [{ id: 'shopping-1', done: true, expenseRecorded: true }],
    });
    expect(testState.data.get(lastBackupKey)).toBe(incoming.createdAt);
    expect(JSON.parse(testState.data.get(remoteRevisionKey)!)).toEqual({
      modifiedTime: '2026-09-10T08:30:00.000Z',
      backupId: incoming.backupId,
      createdAt: incoming.createdAt,
      payloadChecksum: incoming.payloadChecksum,
    });
    expect(probe(renderer)).toMatchObject({
      status: 'success',
      lastBackupAt: incoming.createdAt,
    });
  });

  it('marks a missing backup as blocked during automatic account restore', async () => {
    googleAccountState.connectionGeneration = 1;
    googleAccountState.downloadDriveBackup.mockRejectedValue(
      new ApiError(
        new Response(null, { status: 404, statusText: 'Not Found' }),
        null,
        { method: 'GET', url: '/google/drive/backup' },
      ),
    );

    const renderer = renderBackup();
    await settleEffects();
    await settleEffects();

    expect(probe(renderer)).toMatchObject({
      status: 'error',
      accountRestoreStatus: 'blocked',
      error: 'Akun Google baru belum memiliki backup. Backup otomatis ditahan agar data akun sebelumnya tidak tertimpa. Buat backup manual setelah data siap.',
    });
  });

  it('accepts a legacy backup and exposes a successful restore status', async () => {
    const legacyBackup: StoredBackup = {
      format: 'kasir-miso-online-backup',
      version: 1,
      backupId: 'legacy-2026-09-08T10:00:00.000Z',
      createdAt: '2026-09-08T10:00:00.000Z',
      storage: {
        'warung-state-v2': JSON.stringify({
          menus: [],
          activeOrders: [],
          kitchenOrders: [],
          inventory: [],
          consignments: [],
          expenses: [{
            id: 'expense-legacy',
            title: 'Belanja lama',
            amount: 10_000,
            date: '2026-09-08',
          }],
          sales: [],
          savingsRules: [],
          savingsEntries: [],
        }),
      },
    };
    googleAccountState.downloadDriveBackup.mockResolvedValue({
      content: JSON.stringify(legacyBackup),
      modifiedTime: null,
    });

    const renderer = renderBackup();
    await act(async () => {
      await expect(probe(renderer).restoreLatest()).resolves.toBe(legacyBackup.createdAt);
    });

    expect(JSON.parse(testState.data.get('warung-state-v2')!)).toMatchObject({
      expenses: [{ id: 'expense-legacy' }],
    });
    expect(probe(renderer)).toMatchObject({
      status: 'success',
      lastBackupAt: legacyBackup.createdAt,
    });
    expect(testState.data.has(accountMetadataKey(REMOTE_REVISION_KEY, googleAccountState.email))).toBe(false);
  });
});