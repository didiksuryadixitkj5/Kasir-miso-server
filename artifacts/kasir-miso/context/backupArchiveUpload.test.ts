import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  setBaseUrl,
  uploadGoogleDriveArchive,
} from '@workspace/api-client-react';

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

describe('resumable ZIP backup retry', () => {
  afterEach(() => {
    setBaseUrl(null);
    vi.unstubAllGlobals();
  });

  it('reuses the same upload session and chunk after a lost response', async () => {
    let startAttempts = 0;
    let firstChunkAccepted = false;
    let finalChunkAccepted = false;
    const requestIds: string[] = [];
    const chunkIndexes: string[] = [];

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);

      if (url.endsWith('/api/google/backup/archive') && init?.method === 'POST') {
        startAttempts += 1;
        requestIds.push(headers.get('X-Backup-Request-ID') ?? '');
        if (startAttempts === 1) throw new TypeError('Network request failed');
        return jsonResponse({
          uploadId: 'session-reused',
          chunkSize: 256 * 1024,
          totalChunks: 2,
          nextChunkIndex: 0,
        });
      }

      const index = headers.get('X-Backup-Chunk-Index') ?? '';
      chunkIndexes.push(index);
      if (index === '0') {
        if (!firstChunkAccepted) {
          firstChunkAccepted = true;
          throw new TypeError('Network request failed');
        }
        return jsonResponse({ complete: false, nextChunkIndex: 1 });
      }

      if (!finalChunkAccepted) {
        finalChunkAccepted = true;
        throw new TypeError('Network request failed');
      }
      return jsonResponse({ modifiedTime: '2026-10-21T10:00:00.000Z' });
    });

    vi.stubGlobal('fetch', fetchMock);
    setBaseUrl('https://api.example.test');
    const bytes = new Uint8Array(300_000).fill(5);

    await expect(uploadGoogleDriveArchive(
      { bytes, expectedModifiedTime: null },
      { headers: { Authorization: 'Bearer test', 'X-Device-ID': 'device-test' } },
    )).resolves.toEqual({ modifiedTime: '2026-10-21T10:00:00.000Z' });

    expect(startAttempts).toBe(2);
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toBeTruthy();
    expect(requestIds[1]).toBe(requestIds[0]);
    expect(chunkIndexes).toEqual(['0', '0', '1', '1']);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      'https://api.example.test/api/google/backup/archive/session-reused',
    );
  });
});
