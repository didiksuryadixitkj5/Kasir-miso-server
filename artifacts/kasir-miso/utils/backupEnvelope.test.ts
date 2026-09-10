import { createHash, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => (
    createHash('sha256').update(value).digest('hex')
  ),
  randomUUID,
}));

import {
  createOfflineBackup,
  createStoredBackup,
  hasRemoteRevisionConflict,
  parseOfflineBackup,
  parseStoredBackup,
} from './backupEnvelope';
import { addShoppingExpense } from '@/domain/shoppingExpenses';
import { hydrateWarungState } from '@/domain/menuOrdering';
import { NOTES_STORAGE_KEY } from '@/context/onlineBackupMetadata';

const isAllowedKey = (key: string) => key.startsWith('warung-') || key === NOTES_STORAGE_KEY;

describe('backup envelope', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('creates and validates a versioned SHA-256 backup manifest', async () => {
    const backup = await createStoredBackup({
      'warung-state-v2': JSON.stringify({ menus: [], inventory: [] }),
      'warung-reminders-v1': '[]',
    });

    expect(backup.version).toBe(2);
    expect(backup.checksumAlgorithm).toBe('sha256');
    expect(backup.payloadChecksum).toMatch(/^[a-f0-9]{64}$/);
    await expect(parseStoredBackup(JSON.stringify(backup), isAllowedKey)).resolves.toEqual(backup);
  });

  it('creates and validates a portable offline backup file', () => {
    const backup = createOfflineBackup({
      menus: [],
      expenses: [{ id: 'expense-1', title: 'Gas', amount: 10_000, date: '2026-09-10' }],
      qrisImageUri: null,
    });

    expect(parseOfflineBackup(JSON.stringify(backup))).toEqual(backup);
  });

  it('keeps transactions, QRIS, and legacy expenses through offline restore', async () => {
    const sale = {
      id: 'sale-1',
      amount: 25_000,
      method: 'QRIS' as const,
      items: [{ menu: 'mie', qty: 2 }],
      date: '2026-09-10',
    };
    const legacyExpense = {
      id: 'expense-legacy',
      title: 'Belanja lama',
      amount: 10_000,
      date: '2026-09-09',
    };
    const backup = createOfflineBackup({
      menus: [],
      activeOrders: [],
      kitchenOrders: [],
      inventory: [],
      consignments: [],
      expenses: [legacyExpense],
      sales: [sale],
      savingsRules: [],
      savingsEntries: [],
      qrisImageUri: 'data:image/png;base64,stored-qris',
    });
    const parsed = parseOfflineBackup(JSON.stringify(backup));
    const restoredState = await hydrateWarungState(
      JSON.stringify(parsed.data),
      async (uri) => uri,
    );

    expect(restoredState.sales).toEqual([sale]);
    expect(restoredState.expenses).toEqual([legacyExpense]);
    expect(restoredState.qrisImageUri).toBe('data:image/png;base64,stored-qris');
  });

  it('rejects an invalid offline file before it can be restored', () => {
    expect(() => parseOfflineBackup('{not-json')).toThrow('bukan JSON yang valid');
    expect(() => parseOfflineBackup(JSON.stringify({
      format: 'kasir-miso-backup',
      version: 1,
      target: 'offline',
      createdAt: '2026-09-10T10:00:00.000Z',
      data: { inventory: 'not-an-array' },
    }))).toThrow('bagian inventory tidak valid');
    expect(() => parseOfflineBackup(JSON.stringify({
      format: 'kasir-miso-backup',
      version: 1,
      target: 'offline',
      createdAt: '2026-09-10T10:00:00.000Z',
      data: { qrisImageUri: 123 },
    }))).toThrow('Data QRIS');
  });

  it('rejects a backup whose business data was modified after creation', async () => {
    const backup = await createStoredBackup({
      'warung-state-v2': JSON.stringify({ inventory: [{ id: 'beras', qty: 10 }] }),
    });
    const tampered = {
      ...backup,
      storage: {
        ...backup.storage,
        'warung-state-v2': JSON.stringify({ inventory: [{ id: 'beras', qty: 999 }] }),
      },
    };

    await expect(parseStoredBackup(JSON.stringify(tampered), isAllowedKey))
      .rejects.toThrow('Checksum backup Google Drive tidak cocok');
  });

  it('keeps a shopping item link through backup restore and blocks re-recording it', async () => {
    const expense = {
      id: 'expense-1',
      title: 'Belanja hari ini · Minyak',
      amount: 25_000,
      date: '2026-09-09',
      shoppingItemId: 'shopping-1',
    };
    const backup = await createStoredBackup({
      'warung-state-v2': JSON.stringify({
        menus: [],
        activeOrders: [],
        kitchenOrders: [],
        inventory: [],
        consignments: [],
        expenses: [expense],
        sales: [],
        savingsRules: [],
        savingsEntries: [],
      }),
    });

    const restoredBackup = await parseStoredBackup(JSON.stringify(backup), isAllowedKey);
    const restoredState = await hydrateWarungState(
      restoredBackup.storage['warung-state-v2'],
      async (uri) => uri,
    );
    const retriedState = addShoppingExpense(
      restoredState,
      'shopping-1',
      'Belanja hari ini · Minyak',
      25_000,
      () => 'expense-2',
      '2026-09-09',
    );

    expect(restoredState.expenses).toEqual([expense]);
    expect(retriedState).toBe(restoredState);
    expect(retriedState.expenses).toEqual([expense]);
  });

  it('restores a legacy backup whose expenses do not have shopping item links', async () => {
    const legacyExpense = {
      id: 'expense-legacy',
      title: 'Belanja lama',
      amount: 10_000,
      date: '2026-09-08',
    };
    const legacyBackup = {
      format: 'kasir-miso-online-backup',
      version: 1,
      createdAt: '2026-09-08T10:00:00.000Z',
      storage: {
        'warung-state-v2': JSON.stringify({
          menus: [],
          activeOrders: [],
          kitchenOrders: [],
          inventory: [],
          consignments: [],
          expenses: [legacyExpense],
          sales: [],
          savingsRules: [],
          savingsEntries: [],
        }),
      },
    };

    const restoredBackup = await parseStoredBackup(JSON.stringify(legacyBackup), isAllowedKey);
    await expect(hydrateWarungState(
      restoredBackup.storage['warung-state-v2'],
      async (uri) => uri,
    )).resolves.toMatchObject({ expenses: [legacyExpense] });
  });

  it('keeps shopping note identity and purchase state in the backup payload', async () => {
    const notes = {
      shoppingToday: [{
        id: 'shopping-1',
        text: 'Minyak',
        done: true,
        createdAt: '2026-09-09T08:00:00.000Z',
        quantity: 2,
        unit: 'liter',
        price: 25_000,
        expenseRecorded: true,
      }],
      shoppingTomorrow: [],
      carry: [],
      general: [],
      shoppingTomorrowDate: '2026-09-10',
    };
    const backup = await createStoredBackup({
      'warung-state-v2': JSON.stringify({ menus: [], inventory: [] }),
      [NOTES_STORAGE_KEY]: JSON.stringify(notes),
    });

    const restoredBackup = await parseStoredBackup(JSON.stringify(backup), isAllowedKey);

    expect(JSON.parse(restoredBackup.storage[NOTES_STORAGE_KEY])).toEqual(notes);
  });

  it('detects a Drive revision that this device has never observed', () => {
    expect(hasRemoteRevisionConflict('2026-09-02T10:00:00.000Z', null)).toBe(true);
    expect(hasRemoteRevisionConflict(
      '2026-09-02T10:00:00.000Z',
      '2026-09-02T10:00:00.000Z',
    )).toBe(false);
    expect(hasRemoteRevisionConflict(null, '2026-09-02T10:00:00.000Z')).toBe(false);
  });
});