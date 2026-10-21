import { createHash, randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => (
    createHash('sha256').update(value).digest('hex')
  ),
  randomUUID,
}));

import { createStoredBackup, parseStoredBackup } from './backupEnvelope';
import {
  backupBytesToBase64,
  createBackupArchive,
  restoreBackupArchive,
} from './backupArchive';

const isAllowedKey = (key: string) => key.startsWith('warung-');

describe('ZIP backup archive', () => {
  it('stores image bytes separately and restores an offline backup payload', async () => {
    const backup = {
      format: 'kasir-miso-backup',
      version: 1,
      target: 'offline',
      createdAt: '2026-10-21T10:00:00.000Z',
      data: {
        qrisImageUri: 'data:image/png;base64,AQIDBA==',
        menus: [{ imageUri: 'data:image/jpeg;base64,BwgJCg==' }],
      },
    };
    const archive = await createBackupArchive(
      JSON.stringify(backup),
      'offline',
      backup.createdAt,
    );
    const files = unzipSync(archive);
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    const data = strFromU8(files['data.json']);

    expect(archive[0]).toBe(0x50);
    expect(manifest.assets).toEqual({
      'images/img-000001.png': 'image/png',
      'images/img-000002.jpg': 'image/jpeg',
    });
    expect(files['images/img-000001.png']).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(data).not.toContain('AQIDBA==');

    const restored = restoreBackupArchive(archive, 'offline');
    expect(JSON.parse(restored.restoreImageReferences(restored.payload))).toEqual(backup);
  });

  it('recalculates and verifies the online checksum around extracted images', async () => {
    const backup = await createStoredBackup({
      'warung-state-v2': JSON.stringify({
        menus: [{ imageUri: 'data:image/webp;base64,AQIDBA==' }],
      }),
    });
    const archive = await createBackupArchive(JSON.stringify(backup), 'online', backup.createdAt);
    const restored = restoreBackupArchive(archive, 'online');
    const verified = await parseStoredBackup(restored.payload, isAllowedKey);
    const data = JSON.parse(verified.storage['warung-state-v2']);

    expect(data.menus[0].imageUri).toBe('kasir-miso-image://images/img-000001.webp');
    verified.storage['warung-state-v2'] = restored.restoreImageReferences(verified.storage['warung-state-v2']);
    expect(JSON.parse(verified.storage['warung-state-v2'])).toEqual({
      menus: [{ imageUri: 'data:image/webp;base64,AQIDBA==' }],
    });
  });

  it('preserves several multi-megabyte photo files in one offline ZIP', async () => {
    const photos = Array.from({ length: 3 }, (_, index) => {
      const bytes = new Uint8Array(4 * 1024 * 1024);
      bytes.fill((index + 1) * 61);
      return bytes;
    });
    const backup = {
      format: 'kasir-miso-backup',
      version: 1,
      target: 'offline',
      createdAt: '2026-10-21T10:00:00.000Z',
      data: {
        menus: photos.map((photo) => ({
          imageUri: `data:image/jpeg;base64,${backupBytesToBase64(photo)}`,
        })),
      },
    };

    const archive = await createBackupArchive(
      JSON.stringify(backup),
      'offline',
      backup.createdAt,
    );
    const extracted = unzipSync(archive);
    expect(archive.byteLength).toBeGreaterThan(12 * 1024 * 1024);
    expect(createHash('sha256').update(extracted['images/img-000001.jpg']).digest('hex'))
      .toBe(createHash('sha256').update(photos[0]).digest('hex'));
    expect(createHash('sha256').update(extracted['images/img-000002.jpg']).digest('hex'))
      .toBe(createHash('sha256').update(photos[1]).digest('hex'));
    expect(createHash('sha256').update(extracted['images/img-000003.jpg']).digest('hex'))
      .toBe(createHash('sha256').update(photos[2]).digest('hex'));

    const restored = restoreBackupArchive(archive, 'offline');
    expect(JSON.parse(restored.restoreImageReferences(restored.payload))).toEqual(backup);
  });

  it('rejects an incomplete archive before restoring any content', () => {
    expect(() => restoreBackupArchive(new Uint8Array([0x50, 0x4b, 0x03, 0x04])))
      .toThrow('rusak atau tidak lengkap');
  });
});
