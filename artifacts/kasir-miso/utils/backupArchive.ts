import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import * as Crypto from 'expo-crypto';

export type BackupArchiveTarget = 'offline' | 'online';

type BackupArchiveManifest = {
  format: 'kasir-miso-zip-backup';
  version: 1;
  target: BackupArchiveTarget;
  createdAt: string;
  payloadFile: 'data.json';
  assets: Record<string, string>;
};

const MANIFEST_FILE = 'manifest.json';
const DATA_FILE = 'data.json';
const IMAGE_PATH_PREFIX = 'kasir-miso-image://';
const IMAGE_DATA_URI = /data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})/gi;
const IMAGE_REFERENCE = /kasir-miso-image:\/\/(images\/img-\d{6}\.(?:jpg|png|webp|gif|bmp|avif|heic))/g;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/heic': 'heic',
};

function decodeBase64(value: string): Uint8Array {
  const input = value.replace(/\s/g, '');
  if (input.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(input)) {
    throw new Error('Data gambar di backup tidak valid.');
  }

  const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((input.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < input.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(input[index]);
    const second = BASE64_ALPHABET.indexOf(input[index + 1]);
    const third = input[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(input[index + 2]);
    const fourth = input[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(input[index + 3]);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      throw new Error('Data gambar di backup tidak valid.');
    }
    const packed = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < output.length) output[outputIndex++] = (packed >> 16) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = (packed >> 8) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = packed & 0xff;
  }
  return output;
}

function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 3) << 4) | (second >> 4)];
    output += hasSecond ? BASE64_ALPHABET[((second & 15) << 2) | (third >> 6)] : '=';
    output += hasThird ? BASE64_ALPHABET[third & 63] : '=';
  }
  return output;
}

export function backupBytesToBase64(bytes: Uint8Array) {
  return encodeBase64(bytes);
}

export function backupBase64ToBytes(value: string) {
  return decodeBase64(value);
}

function verifyZipDirectory(bytes: Uint8Array) {
  const searchStart = Math.max(0, bytes.length - 65_557);
  let endRecordOffset = -1;
  for (let index = bytes.length - 22; index >= searchStart; index -= 1) {
    if (
      bytes[index] === 0x50
      && bytes[index + 1] === 0x4b
      && bytes[index + 2] === 0x05
      && bytes[index + 3] === 0x06
    ) {
      endRecordOffset = index;
      break;
    }
  }
  if (endRecordOffset < 0) throw new Error('File backup ZIP rusak atau tidak lengkap.');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const diskNumber = view.getUint16(endRecordOffset + 4, true);
  const directoryDisk = view.getUint16(endRecordOffset + 6, true);
  const entryCount = view.getUint16(endRecordOffset + 10, true);
  const directorySize = view.getUint32(endRecordOffset + 12, true);
  const directoryOffset = view.getUint32(endRecordOffset + 16, true);
  if (
    diskNumber !== 0
    || directoryDisk !== 0
    || entryCount === 0
    || entryCount === 0xffff
    || directorySize === 0xffffffff
    || directoryOffset === 0xffffffff
    || directoryOffset + directorySize > endRecordOffset
  ) {
    throw new Error('Struktur file backup ZIP tidak didukung.');
  }

  let cursor = directoryOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > bytes.length
      || bytes[cursor] !== 0x50
      || bytes[cursor + 1] !== 0x4b
      || bytes[cursor + 2] !== 0x01
      || bytes[cursor + 3] !== 0x02
    ) {
      throw new Error('Daftar isi file backup ZIP tidak valid.');
    }
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('File backup ZIP terlalu besar untuk dipulihkan di perangkat ini.');
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('Isi backup ZIP melebihi batas aman untuk dipulihkan di perangkat ini.');
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor > directoryOffset + directorySize) {
    throw new Error('Daftar isi file backup ZIP tidak lengkap.');
  }
}

function parseManifest(raw: string): BackupArchiveManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Manifest backup ZIP tidak valid.');
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || (parsed as Record<string, unknown>).format !== 'kasir-miso-zip-backup'
    || (parsed as Record<string, unknown>).version !== 1
    || !['offline', 'online'].includes(String((parsed as Record<string, unknown>).target))
    || typeof (parsed as Record<string, unknown>).createdAt !== 'string'
    || !Number.isFinite(Date.parse(String((parsed as Record<string, unknown>).createdAt)))
    || (parsed as Record<string, unknown>).payloadFile !== DATA_FILE
    || !(parsed as Record<string, unknown>).assets
    || typeof (parsed as Record<string, unknown>).assets !== 'object'
    || Array.isArray((parsed as Record<string, unknown>).assets)
  ) {
    throw new Error('Format file backup ZIP tidak dikenali.');
  }

  const assets = (parsed as Record<string, unknown>).assets as Record<string, unknown>;
  for (const [path, mimeType] of Object.entries(assets)) {
    if (
      !/^images\/img-\d{6}\.(?:jpg|png|webp|gif|bmp|avif|heic)$/.test(path)
      || typeof mimeType !== 'string'
      || !mimeType.startsWith('image/')
    ) {
      throw new Error('Daftar gambar di backup ZIP tidak valid.');
    }
  }

  return parsed as BackupArchiveManifest;
}

export function createBackupArchive(
  payload: string,
  target: BackupArchiveTarget,
  createdAt: string,
): Promise<Uint8Array> {
  return createBackupArchiveAsync(payload, target, createdAt);
}

async function createBackupArchiveAsync(
  payload: string,
  target: BackupArchiveTarget,
  createdAt: string,
): Promise<Uint8Array> {
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error('Waktu pembuatan backup tidak valid.');
  }

  const files: Record<string, Uint8Array> = {};
  const assets: Record<string, string> = {};
  let assetIndex = 0;
  const replaceImages = (text: string) => text.replace(
    IMAGE_DATA_URI,
    (dataUri, mimeType: string, base64: string) => {
    const extension = IMAGE_EXTENSIONS[mimeType.toLowerCase()];
    if (!extension) return dataUri;
    assetIndex += 1;
    const path = `images/img-${String(assetIndex).padStart(6, '0')}.${extension}`;
    files[path] = decodeBase64(base64);
    assets[path] = mimeType.toLowerCase();
    return `${IMAGE_PATH_PREFIX}${path}`;
    },
  );

  let payloadWithReferences: string;
  if (target === 'online') {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      throw new Error('Data backup Google tidak valid sebelum dikemas.');
    }
    const storage = parsed.storage;
    if (!storage || typeof storage !== 'object' || Array.isArray(storage)) {
      throw new Error('Data backup Google tidak valid sebelum dikemas.');
    }
    const normalizedStorage = storage as Record<string, unknown>;
    for (const [key, value] of Object.entries(normalizedStorage)) {
      if (typeof value === 'string') normalizedStorage[key] = replaceImages(value);
    }
    const backupId = parsed.backupId;
    const backupCreatedAt = parsed.createdAt;
    if (
      typeof backupId !== 'string'
      || typeof backupCreatedAt !== 'string'
      || parsed.checksumAlgorithm !== 'sha256'
    ) {
      throw new Error('Manifest backup Google tidak valid sebelum dikemas.');
    }
    const canonicalStorage = JSON.stringify(Object.fromEntries(
      Object.entries(normalizedStorage).sort(([left], [right]) => left.localeCompare(right)),
    ));
    parsed.payloadChecksum = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify({
        backupId,
        createdAt: backupCreatedAt,
        storage: canonicalStorage,
      }),
    );
    payloadWithReferences = JSON.stringify(parsed);
  } else {
    payloadWithReferences = replaceImages(payload);
  }

  files[DATA_FILE] = strToU8(payloadWithReferences);
  const manifest: BackupArchiveManifest = {
    format: 'kasir-miso-zip-backup',
    version: 1,
    target,
    createdAt,
    payloadFile: DATA_FILE,
    assets,
  };
  files[MANIFEST_FILE] = strToU8(JSON.stringify(manifest));
  const archive = zipSync(files, { level: 0 });
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('File backup ZIP melebihi 100 MB. Kurangi ukuran gambar lalu coba lagi.');
  }
  return archive;
}

export function restoreBackupArchive(bytes: Uint8Array, expectedTarget?: BackupArchiveTarget) {
  if (!bytes.byteLength || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Ukuran file backup ZIP tidak valid atau melebihi 100 MB.');
  }
  verifyZipDirectory(bytes);
  const files = unzipSync(bytes);
  const rawManifest = files[MANIFEST_FILE];
  const rawPayload = files[DATA_FILE];
  if (!rawManifest || !rawPayload) throw new Error('Isi file backup ZIP tidak lengkap.');

  const manifest = parseManifest(strFromU8(rawManifest));
  if (expectedTarget && manifest.target !== expectedTarget) {
    throw new Error('Jenis file backup tidak sesuai dengan tujuan pemulihan.');
  }

  for (const path of Object.keys(manifest.assets)) {
    if (!files[path]) throw new Error('Salah satu gambar di backup ZIP tidak ditemukan.');
  }

  return {
    target: manifest.target,
    createdAt: manifest.createdAt,
    payload: strFromU8(rawPayload),
    restoreImageReferences: (payload: string) => payload.replace(
      IMAGE_REFERENCE,
      (reference, path: string) => {
        const image = files[path];
        const mimeType = manifest.assets[path];
        if (!image || !mimeType) throw new Error('Salah satu gambar di backup ZIP tidak ditemukan.');
        return `data:${mimeType};base64,${encodeBase64(image)}`;
      },
    ),
  };
}
