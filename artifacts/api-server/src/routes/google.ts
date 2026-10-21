import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pool } from "@workspace/db";
import { Router, type IRouter, type Request } from "express";

const router: IRouter = Router();
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const BACKUP_FILE_NAME = "Kasir Miso Backup.json";
const BACKUP_ARCHIVE_FILE_NAME = "Kasir Miso Backup.zip";
const BACKUP_LOOKUP_UNAVAILABLE = "Status backup Google Drive belum dapat dipastikan. Coba lagi saat koneksi Google Drive tersedia.";
const SESSION_TTL_DAYS = 30;
const BACKUP_ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
const BACKUP_ARCHIVE_CHUNK_BYTES = 256 * 1024;

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  email?: string;
};

type GoogleFile = {
  id: string;
  name?: string;
  modifiedTime?: string;
  size?: string;
};

type GoogleFilesResponse = {
  files?: GoogleFile[];
};

type GoogleConnectionRow = {
  device_id: string;
  email: string;
  client_id: string;
  encrypted_refresh_token: string;
  drive_file_id: string | null;
};

type AuthenticatedConnection = GoogleConnectionRow & {
  session_hash: string;
};

class GoogleBackupError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleBackupError";
  }
}

type PendingBackupUpload = {
  deviceId: string;
  totalChunks: number;
  expectedModifiedTime: string | null;
  chunks: Map<number, string>;
  createdAt: number;
};

type PendingBackupDownload = {
  deviceId: string;
  content: string;
  totalChunks: number;
  modifiedTime: string | null;
  createdAt: number;
};

type PendingArchiveUpload = {
  deviceId: string;
  requestId: string;
  uploadId: string;
  sessionUrl: string;
  accessToken: string;
  fileId: string | null;
  totalBytes: number;
  totalChunks: number;
  expectedModifiedTime: string | null;
  nextChunkIndex: number;
  createdAt: number;
  result?: { modifiedTime: string };
};

let schemaPromise: Promise<unknown> | null = null;
const pendingBackupUploads = new Map<string, PendingBackupUpload>();
const pendingBackupDownloads = new Map<string, PendingBackupDownload>();
const pendingArchiveUploads = new Map<string, PendingArchiveUpload>();
const BACKUP_CHUNK_TTL_MS = 10 * 60 * 1000;
const MAX_BACKUP_CHUNKS = 200;
const MAX_BACKUP_CHUNK_LENGTH = 300 * 1024;
const BACKUP_DOWNLOAD_CHUNK_LENGTH = 48 * 1024;

function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS google_connections (
        device_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        client_id TEXT NOT NULL,
        encrypted_refresh_token TEXT NOT NULL,
        drive_file_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS google_sessions (
        session_hash TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES google_connections(device_id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS google_sessions_device_idx
        ON google_sessions (device_id);
    `);
  }
  return schemaPromise;
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required for Google sessions.");
  }
  return createHash("sha256").update(secret).digest();
}

function encryptRefreshToken(refreshToken: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSessionSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64url"), authTag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptRefreshToken(value: string) {
  const [ivValue, authTagValue, encryptedValue] = value.split(".");
  if (!ivValue || !authTagValue || !encryptedValue) {
    throw new Error("Stored Google token is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getSessionSecret(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function getAllowedClientIds() {
  return new Set(
    (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function getWebClientId() {
  return (
    process.env.GOOGLE_OAUTH_WEB_CLIENT_ID?.trim()
    || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim()
    || ""
  );
}

function getDeviceId(req: Request) {
  const value = req.header("X-Device-ID")?.trim();
  return value && value.length <= 200 ? value : null;
}

function getBearerToken(req: Request) {
  const authorization = req.header("Authorization") ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

function sendError(res: { status: (status: number) => { json: (body: unknown) => void } }, status: number, message: string) {
  res.status(status).json({ message });
}

function isTransientNetworkError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return code === "EAI_AGAIN"
    || code === "ETIMEDOUT"
    || message.includes("EAI_AGAIN")
    || message.includes("ETIMEDOUT");
}

async function fetchGoogle(input: string, init?: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (!isTransientNetworkError(error) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error("Google belum dapat dihubungi.");
}

async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}) {
  const body = new URLSearchParams({
    code: input.code,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const webClientId = getWebClientId();
  if (input.clientId === webClientId) {
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientSecret) throw new Error("Google OAuth server secret belum dikonfigurasi.");
    body.set("client_secret", clientSecret);
  }

  const response = await fetchGoogle(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google tidak menerima kode login.");
  }
  return data;
}

async function fetchUserEmail(accessToken: string) {
  const response = await fetchGoogle(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await response.json()) as GoogleUserInfo;
  if (!response.ok || !data.email) {
    throw new Error("Email akun Google tidak dapat diverifikasi.");
  }
  return data.email;
}

async function getAuthenticatedConnection(req: Request): Promise<AuthenticatedConnection | null> {
  const deviceId = getDeviceId(req);
  const token = getBearerToken(req);
  if (!deviceId || !token) return null;
  await ensureSchema();
  const result = await pool.query<AuthenticatedConnection>(
    `
      SELECT c.device_id, c.email, c.client_id, c.encrypted_refresh_token,
             c.drive_file_id, s.session_hash
      FROM google_sessions s
      JOIN google_connections c ON c.device_id = s.device_id
      WHERE s.session_hash = $1
        AND s.expires_at > NOW()
        AND s.device_id = $2
    `,
    [hashSessionToken(token), deviceId],
  );
  return result.rows[0] ?? null;
}

async function getAccessToken(connection: GoogleConnectionRow) {
  const body = new URLSearchParams({
    client_id: connection.client_id,
    refresh_token: decryptRefreshToken(connection.encrypted_refresh_token),
    grant_type: "refresh_token",
  });
  if (connection.client_id === getWebClientId()) {
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientSecret) throw new Error("Google OAuth server secret belum dikonfigurasi.");
    body.set("client_secret", clientSecret);
  }
  const response = await fetchGoogle(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Sesi Google sudah tidak berlaku.");
  }
  return data.access_token;
}

async function findBackupFile(accessToken: string, fileId?: string | null) {
  if (fileId) {
    const response = await fetchGoogle(`${GOOGLE_FILES_URL}/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) return (await response.json()) as GoogleFile;
    if (response.status !== 404) throw new Error(BACKUP_LOOKUP_UNAVAILABLE);
  }
  const query = encodeURIComponent(`name = '${BACKUP_FILE_NAME.replaceAll("'", "\\'")}' and trashed = false`);
  const orderBy = encodeURIComponent("modifiedTime desc");
  const response = await fetchGoogle(
    `${GOOGLE_FILES_URL}?q=${query}&fields=files(id,name,modifiedTime)&orderBy=${orderBy}&pageSize=1`,
    {
    headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) throw new Error(BACKUP_LOOKUP_UNAVAILABLE);
  const data = (await response.json()) as GoogleFilesResponse;
  return data.files?.[0] ?? null;
}

async function findBackupArchiveFile(accessToken: string, fileId?: string | null) {
  if (fileId) {
    const response = await fetchGoogle(`${GOOGLE_FILES_URL}/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,size`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) return (await response.json()) as GoogleFile;
    if (response.status !== 404) throw new Error(BACKUP_LOOKUP_UNAVAILABLE);
  }
  const query = encodeURIComponent(
    `(name = '${BACKUP_ARCHIVE_FILE_NAME}' or name = '${BACKUP_FILE_NAME}') and trashed = false`,
  );
  const orderBy = encodeURIComponent("modifiedTime desc");
  const response = await fetchGoogle(
    `${GOOGLE_FILES_URL}?q=${query}&fields=files(id,name,modifiedTime,size)&orderBy=${orderBy}&pageSize=10`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw new Error(BACKUP_LOOKUP_UNAVAILABLE);
  const data = (await response.json()) as GoogleFilesResponse;
  return data.files?.[0] ?? null;
}

async function updateDriveFileId(deviceId: string, fileId: string) {
  await pool.query(
    "UPDATE google_connections SET drive_file_id = $1, updated_at = NOW() WHERE device_id = $2",
    [fileId, deviceId],
  );
}

function cleanupPendingBackupUploads(activeArchiveUploadKey?: string) {
  const cutoff = Date.now() - BACKUP_CHUNK_TTL_MS;
  for (const [uploadId, upload] of pendingBackupUploads) {
    if (upload.createdAt < cutoff) pendingBackupUploads.delete(uploadId);
  }
  for (const [downloadId, download] of pendingBackupDownloads) {
    if (download.createdAt < cutoff) pendingBackupDownloads.delete(downloadId);
  }
  for (const [uploadKey, upload] of pendingArchiveUploads) {
    if (uploadKey !== activeArchiveUploadKey && upload.createdAt < cutoff) {
      pendingArchiveUploads.delete(uploadKey);
    }
  }
}

async function saveBackupToDrive(
  connection: AuthenticatedConnection,
  content: string,
  expectedModifiedTime: string | null,
) {
  const accessToken = await getAccessToken(connection);
  const file = await findBackupFile(accessToken, connection.drive_file_id);
  if (file?.modifiedTime && expectedModifiedTime && file.modifiedTime !== expectedModifiedTime) {
    throw new GoogleBackupError(409, "Backup Google Drive lebih baru ditemukan dari perangkat lain.");
  }

  let fileId = file?.id;
  let modifiedTime: string;
  if (fileId) {
    const response = await fetchGoogle(`${GOOGLE_UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: content,
    });
    if (!response.ok) throw new GoogleBackupError(response.status, "Backup Google Drive belum dapat diperbarui.");
    const metadataResponse = await fetchGoogle(`${GOOGLE_FILES_URL}/${encodeURIComponent(fileId)}?fields=id,modifiedTime`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!metadataResponse.ok) {
      throw new GoogleBackupError(
        502,
        "Backup Google Drive sudah diperbarui, tetapi waktu perubahannya belum dapat dikonfirmasi.",
      );
    }
    const updated = (await metadataResponse.json()) as GoogleFile;
    if (!updated.modifiedTime) {
      throw new GoogleBackupError(
        502,
        "Backup Google Drive sudah diperbarui, tetapi waktu perubahannya belum dapat dikonfirmasi.",
      );
    }
    modifiedTime = updated.modifiedTime;
  } else {
    const boundary = `kasir-miso-${randomBytes(12).toString("hex")}`;
    const metadata = JSON.stringify({ name: BACKUP_FILE_NAME, mimeType: "application/json" });
    const multipartBody = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      metadata,
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      content,
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const response = await fetchGoogle(`${GOOGLE_UPLOAD_URL}?uploadType=multipart&fields=id,modifiedTime`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });
    const created = (await response.json()) as GoogleFile;
    if (!response.ok || !created.id) {
      throw new GoogleBackupError(response.status, "Backup Google Drive belum dapat dibuat.");
    }
    fileId = created.id;
    if (!created.modifiedTime) {
      await updateDriveFileId(connection.device_id, created.id);
      throw new GoogleBackupError(
        502,
        "Backup Google Drive sudah dibuat, tetapi waktu perubahannya belum dapat dikonfirmasi.",
      );
    }
    modifiedTime = created.modifiedTime;
  }
  if (fileId) await updateDriveFileId(connection.device_id, fileId);
  return { modifiedTime };
}

router.post("/google/connect", async (req, res) => {
  try {
    const { code, codeVerifier, redirectUri, clientId, deviceId } = req.body as Record<string, unknown>;
    if (![code, codeVerifier, redirectUri, clientId, deviceId].every((value) => typeof value === "string" && value.trim())) {
      return sendError(res, 400, "Data login Google belum lengkap.");
    }
    const allowedClientIds = getAllowedClientIds();
    if (!allowedClientIds.has(clientId as string)) {
      return sendError(res, 400, "Client ID Google belum diizinkan oleh server.");
    }

    const tokenData = await exchangeAuthorizationCode({
      code: code as string,
      codeVerifier: codeVerifier as string,
      redirectUri: redirectUri as string,
      clientId: clientId as string,
    });
    const email = await fetchUserEmail(tokenData.access_token as string);
    await ensureSchema();

    const existing = await pool.query<{ email: string; encrypted_refresh_token: string }>(
      "SELECT email, encrypted_refresh_token FROM google_connections WHERE device_id = $1",
      [deviceId],
    );
    const existingConnection = existing.rows[0];
    const refreshToken = tokenData.refresh_token
      ? encryptRefreshToken(tokenData.refresh_token)
      : existingConnection?.encrypted_refresh_token;
    if (
      !tokenData.refresh_token
      && existingConnection
      && existingConnection.email.toLowerCase() !== email.toLowerCase()
    ) {
      return sendError(
        res,
        400,
        "Google belum memberikan token Drive untuk akun baru. Logout akun lama, lalu pilih akun Google baru dan setujui izin Drive.",
      );
    }
    if (!refreshToken) {
      return sendError(res, 400, "Google tidak memberikan izin refresh token. Ulangi login dan setujui akses Drive.");
    }

    await pool.query(
      `
        INSERT INTO google_connections (device_id, email, client_id, encrypted_refresh_token, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (device_id) DO UPDATE SET
          email = EXCLUDED.email,
          client_id = EXCLUDED.client_id,
          encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          drive_file_id = CASE
            WHEN LOWER(google_connections.email) <> LOWER(EXCLUDED.email) THEN NULL
            ELSE google_connections.drive_file_id
          END,
          updated_at = NOW()
      `,
      [deviceId, email, clientId, refreshToken],
    );

    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await pool.query("DELETE FROM google_sessions WHERE device_id = $1", [deviceId]);
    await pool.query(
      "INSERT INTO google_sessions (session_hash, device_id, expires_at) VALUES ($1, $2, $3)",
      [hashSessionToken(sessionToken), deviceId, expiresAt],
    );
    return res.json({ sessionToken, expiresAt: expiresAt.toISOString(), email });
  } catch (error) {
    return sendError(res, 400, error instanceof Error ? error.message : "Login Google belum berhasil.");
  }
});

router.get("/google/connection", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");
    return res.json({ email: connection.email });
  } catch {
    return sendError(res, 500, "Status koneksi Google belum dapat diperiksa.");
  }
});

router.delete("/google/connection", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");
    await pool.query("DELETE FROM google_connections WHERE device_id = $1", [connection.device_id]);
    return res.status(204).send();
  } catch {
    return sendError(res, 500, "Logout Google belum berhasil.");
  }
});

router.get("/google/backup", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");
    const accessToken = await getAccessToken(connection);
    const file = await findBackupFile(accessToken, connection.drive_file_id);
    if (!file?.id) return sendError(res, 404, "Backup Kasir Miso belum tersedia di Google Drive.");
    await updateDriveFileId(connection.device_id, file.id);
    const response = await fetchGoogle(`${GOOGLE_FILES_URL}/${encodeURIComponent(file.id)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return sendError(res, response.status, "Backup Google Drive belum dapat diunduh.");
    return res.json({ content: await response.text(), modifiedTime: file.modifiedTime ?? null });
  } catch (error) {
    return sendError(res, 502, error instanceof Error ? error.message : "Backup Google Drive belum dapat diunduh.");
  }
});

router.put("/google/backup", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");
    const { content, expectedModifiedTime } = req.body as Record<string, unknown>;
    if (typeof content !== "string") return sendError(res, 400, "Isi backup tidak valid.");
    const result = await saveBackupToDrive(
      connection,
      content,
      typeof expectedModifiedTime === "string" ? expectedModifiedTime : null,
    );
    return res.json(result);
  } catch (error) {
    if (error instanceof GoogleBackupError) return sendError(res, error.status, error.message);
    return sendError(res, 502, error instanceof Error ? error.message : "Backup Google Drive belum dapat disimpan.");
  }
});

router.get("/google/backup/chunk", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");

    cleanupPendingBackupUploads();
    const downloadId = typeof req.query.downloadId === "string" ? req.query.downloadId : null;
    const rawChunkIndex = typeof req.query.chunkIndex === "string" ? req.query.chunkIndex : null;

    if (!downloadId) {
      const accessToken = await getAccessToken(connection);
      const file = await findBackupFile(accessToken, connection.drive_file_id);
      if (!file?.id) return sendError(res, 404, "Backup Kasir Miso belum tersedia di Google Drive.");
      await updateDriveFileId(connection.device_id, file.id);
      const response = await fetchGoogle(`${GOOGLE_FILES_URL}/${encodeURIComponent(file.id)}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return sendError(res, response.status, "Backup Google Drive belum dapat diunduh.");

      const content = await response.text();
      const totalChunks = Math.max(1, Math.ceil(content.length / BACKUP_DOWNLOAD_CHUNK_LENGTH));
      const nextDownloadId = `download-${randomBytes(12).toString("hex")}`;
      pendingBackupDownloads.set(`${connection.device_id}:${nextDownloadId}`, {
        deviceId: connection.device_id,
        content,
        totalChunks,
        modifiedTime: file.modifiedTime ?? null,
        createdAt: Date.now(),
      });
      return res.json({
        downloadId: nextDownloadId,
        totalChunks,
        modifiedTime: file.modifiedTime ?? null,
      });
    }

    const download = pendingBackupDownloads.get(`${connection.device_id}:${downloadId}`);
    const chunkIndex = Number(rawChunkIndex);
    if (
      !download
      || download.deviceId !== connection.device_id
      || rawChunkIndex === null
      || !Number.isInteger(chunkIndex)
      || chunkIndex < 0
      || chunkIndex >= download.totalChunks
    ) {
      return sendError(res, 400, "Permintaan potongan restore tidak valid.");
    }

    const content = download.content.slice(
      chunkIndex * BACKUP_DOWNLOAD_CHUNK_LENGTH,
      (chunkIndex + 1) * BACKUP_DOWNLOAD_CHUNK_LENGTH,
    );
    if (chunkIndex === download.totalChunks - 1) {
      pendingBackupDownloads.delete(`${connection.device_id}:${downloadId}`);
    }
    return res.json({
      content,
      chunkIndex,
      totalChunks: download.totalChunks,
      modifiedTime: download.modifiedTime,
    });
  } catch (error) {
    return sendError(res, 502, error instanceof Error ? error.message : "Backup Google Drive belum dapat diunduh.");
  }
});

router.put("/google/backup/chunk", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");

    cleanupPendingBackupUploads();
    const uploadId = req.get("X-Backup-Upload-ID");
    const chunkIndex = Number(req.get("X-Backup-Chunk-Index"));
    const totalChunks = Number(req.get("X-Backup-Chunk-Total"));
    const { content, expectedModifiedTime } = req.body as Record<string, unknown>;
    if (
      !uploadId
      || !Number.isInteger(chunkIndex)
      || chunkIndex < 0
      || !Number.isInteger(totalChunks)
      || totalChunks < 1
      || totalChunks > MAX_BACKUP_CHUNKS
      || chunkIndex >= totalChunks
      || typeof content !== "string"
      || content.length > MAX_BACKUP_CHUNK_LENGTH
    ) {
      return sendError(res, 400, "Potongan backup tidak valid.");
    }

    const key = `${connection.device_id}:${uploadId}`;
    let upload = pendingBackupUploads.get(key);
    if (!upload) {
      upload = {
        deviceId: connection.device_id,
        totalChunks,
        expectedModifiedTime: typeof expectedModifiedTime === "string" ? expectedModifiedTime : null,
        chunks: new Map(),
        createdAt: Date.now(),
      };
      pendingBackupUploads.set(key, upload);
    }
    if (
      upload.deviceId !== connection.device_id
      || upload.totalChunks !== totalChunks
      || upload.expectedModifiedTime !== (typeof expectedModifiedTime === "string" ? expectedModifiedTime : null)
    ) {
      pendingBackupUploads.delete(key);
      return sendError(res, 400, "Rangkaian potongan backup berubah. Coba backup lagi.");
    }

    upload.chunks.set(chunkIndex, content);
    if (upload.chunks.size !== totalChunks) {
      return res.status(202).json({ complete: false });
    }

    const assembled = Array.from({ length: totalChunks }, (_, index) => upload?.chunks.get(index));
    if (assembled.some((part): part is undefined => part === undefined)) {
      return res.status(202).json({ complete: false });
    }
    pendingBackupUploads.delete(key);
    const result = await saveBackupToDrive(connection, assembled.join(""), upload.expectedModifiedTime);
    return res.json(result);
  } catch (error) {
    if (error instanceof GoogleBackupError) return sendError(res, error.status, error.message);
    return sendError(res, 502, error instanceof Error ? error.message : "Backup Google Drive belum dapat disimpan.");
  }
});

router.get("/google/backup/archive/info", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");
    cleanupPendingBackupUploads();
    const accessToken = await getAccessToken(connection);
    const file = await findBackupArchiveFile(accessToken, connection.drive_file_id);
    if (!file?.id) return sendError(res, 404, "Backup Kasir Miso belum tersedia di Google Drive.");
    await updateDriveFileId(connection.device_id, file.id);
    return res.json({
      modifiedTime: file.modifiedTime ?? null,
      size: Number(file.size ?? 0),
      name: file.name ?? BACKUP_ARCHIVE_FILE_NAME,
    });
  } catch (error) {
    return sendError(res, 502, error instanceof Error ? error.message : "Status backup Google Drive belum dapat diperiksa.");
  }
});

router.get("/google/backup/archive", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");
    const accessToken = await getAccessToken(connection);
    const file = await findBackupArchiveFile(accessToken, connection.drive_file_id);
    if (!file?.id) return sendError(res, 404, "Backup Kasir Miso belum tersedia di Google Drive.");
    await updateDriveFileId(connection.device_id, file.id);
    const response = await fetchGoogle(
      `${GOOGLE_FILES_URL}/${encodeURIComponent(file.id)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok || !response.body) {
      return sendError(res, response.status || 502, "Backup Google Drive belum dapat diunduh.");
    }

    res.status(200);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${BACKUP_ARCHIVE_FILE_NAME}"`);
    const contentLength = response.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    const stream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
    return;
  } catch (error) {
    if (res.headersSent) return res.destroy();
    return sendError(res, 502, error instanceof Error ? error.message : "Backup Google Drive belum dapat diunduh.");
  }
});

router.post("/google/backup/archive", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");

    const { totalBytes, expectedModifiedTime } = req.body as Record<string, unknown>;
    if (
      !Number.isSafeInteger(totalBytes)
      || (totalBytes as number) < 1
      || (totalBytes as number) > BACKUP_ARCHIVE_MAX_BYTES
      || (expectedModifiedTime !== null && typeof expectedModifiedTime !== "string")
    ) {
      return sendError(res, 400, "Ukuran atau versi backup ZIP tidak valid.");
    }

    const requestId = req.get("X-Backup-Request-ID")?.trim();
    if (!requestId || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) {
      return sendError(res, 400, "ID permintaan backup ZIP tidak valid.");
    }

    cleanupPendingBackupUploads();
    const existingUpload = [...pendingArchiveUploads.values()].find(
      (upload) => upload.deviceId === connection.device_id && upload.requestId === requestId,
    );
    const normalizedExpectedModifiedTime = typeof expectedModifiedTime === "string"
      ? expectedModifiedTime
      : null;
    if (existingUpload) {
      if (
        existingUpload.totalBytes !== totalBytes
        || existingUpload.expectedModifiedTime !== normalizedExpectedModifiedTime
      ) {
        return sendError(res, 409, "ID backup ZIP sudah digunakan untuk data yang berbeda.");
      }
      existingUpload.createdAt = Date.now();
      if (existingUpload.result) return res.json(existingUpload.result);
      return res.json({
        uploadId: existingUpload.uploadId,
        chunkSize: BACKUP_ARCHIVE_CHUNK_BYTES,
        totalChunks: existingUpload.totalChunks,
        nextChunkIndex: existingUpload.nextChunkIndex,
      });
    }

    const accessToken = await getAccessToken(connection);
    const file = await findBackupArchiveFile(accessToken, connection.drive_file_id);
    if (
      file?.modifiedTime
      && expectedModifiedTime
      && file.modifiedTime !== expectedModifiedTime
    ) {
      return sendError(res, 409, "Backup Google Drive lebih baru ditemukan dari perangkat lain.");
    }

    const chunkSize = BACKUP_ARCHIVE_CHUNK_BYTES;
    const totalChunks = Math.ceil((totalBytes as number) / chunkSize);
    const uploadUrl = file?.id
      ? `${GOOGLE_UPLOAD_URL}/${encodeURIComponent(file.id)}?uploadType=resumable&fields=id,modifiedTime`
      : `${GOOGLE_UPLOAD_URL}?uploadType=resumable&fields=id,modifiedTime`;
    const metadata = JSON.stringify({
      name: BACKUP_ARCHIVE_FILE_NAME,
      mimeType: "application/zip",
    });
    const startResponse = await fetchGoogle(uploadUrl, {
      method: file?.id ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/zip",
        "X-Upload-Content-Length": String(totalBytes),
      },
      body: metadata,
    });
    if (!startResponse.ok) {
      return sendError(res, startResponse.status, "Sesi upload backup ZIP ke Google Drive belum dapat dibuat.");
    }
    const sessionUrl = startResponse.headers.get("location");
    if (!sessionUrl) {
      return sendError(res, 502, "Google Drive tidak mengembalikan sesi upload untuk backup ZIP.");
    }

    const uploadId = `archive-${randomBytes(16).toString("hex")}`;
    pendingArchiveUploads.set(`${connection.device_id}:${uploadId}`, {
      deviceId: connection.device_id,
      requestId,
      uploadId,
      sessionUrl,
      accessToken,
      fileId: file?.id ?? null,
      totalBytes: totalBytes as number,
      totalChunks,
      expectedModifiedTime: typeof expectedModifiedTime === "string" ? expectedModifiedTime : null,
      nextChunkIndex: 0,
      createdAt: Date.now(),
    });
    return res.json({ uploadId, chunkSize, totalChunks, nextChunkIndex: 0 });
  } catch (error) {
    if (error instanceof GoogleBackupError) return sendError(res, error.status, error.message);
    return sendError(res, 502, error instanceof Error ? error.message : "Sesi upload backup ZIP belum dapat dibuat.");
  }
});

router.put("/google/backup/archive/:uploadId", async (req, res) => {
  try {
    const connection = await getAuthenticatedConnection(req);
    if (!connection) return sendError(res, 401, "Sesi Google tidak ditemukan atau sudah kedaluwarsa.");

    const uploadId = req.params.uploadId;
    const key = `${connection.device_id}:${uploadId}`;
    cleanupPendingBackupUploads(key);
    const upload = pendingArchiveUploads.get(key);
    if (!upload || upload.deviceId !== connection.device_id) {
      return sendError(res, 404, "Sesi upload backup ZIP sudah tidak berlaku. Mulai backup lagi.");
    }

    const chunkIndex = Number(req.get("X-Backup-Chunk-Index"));
    const totalChunks = Number(req.get("X-Backup-Chunk-Total"));
    const content = req.body;
    if (
      !Number.isInteger(chunkIndex)
      || !Number.isInteger(totalChunks)
      || totalChunks !== upload.totalChunks
      || chunkIndex < 0
      || chunkIndex >= upload.totalChunks
      || !Buffer.isBuffer(content)
      || content.byteLength < 1
      || content.byteLength > BACKUP_ARCHIVE_CHUNK_BYTES
    ) {
      return sendError(res, 400, "Potongan file backup ZIP tidak valid.");
    }

    if (upload.result) return res.json(upload.result);
    if (chunkIndex < upload.nextChunkIndex) {
      return res.status(202).json({ complete: false, nextChunkIndex: upload.nextChunkIndex });
    }
    if (chunkIndex !== upload.nextChunkIndex) {
      return sendError(res, 409, "Urutan potongan backup ZIP tidak sesuai. Ulangi backup dari awal.");
    }

    const start = chunkIndex * BACKUP_ARCHIVE_CHUNK_BYTES;
    const end = start + content.byteLength - 1;
    const expectedChunkLength = Math.min(BACKUP_ARCHIVE_CHUNK_BYTES, upload.totalBytes - start);
    if (content.byteLength !== expectedChunkLength || end >= upload.totalBytes) {
      return sendError(res, 400, "Ukuran potongan backup ZIP tidak sesuai.");
    }
    upload.createdAt = Date.now();

    const driveResponse = await fetchGoogle(upload.sessionUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${upload.accessToken}`,
        "Content-Type": "application/zip",
        "Content-Length": String(content.byteLength),
        "Content-Range": `bytes ${start}-${end}/${upload.totalBytes}`,
      },
      body: content,
    });

    if (driveResponse.status === 308) {
      upload.nextChunkIndex += 1;
      return res.status(202).json({ complete: false, nextChunkIndex: upload.nextChunkIndex });
    }
    if (!driveResponse.ok) {
      return sendError(res, 502, "Google Drive belum menerima potongan backup ZIP. Coba lagi.");
    }

    const completedFile = (await driveResponse.json()) as GoogleFile;
    const completedFileId = completedFile.id ?? upload.fileId;
    if (!completedFileId) {
      return sendError(res, 502, "Google Drive selesai menerima file, tetapi ID backup tidak tersedia.");
    }

    let modifiedTime = completedFile.modifiedTime;
    if (!modifiedTime) {
      const metadataResponse = await fetchGoogle(
        `${GOOGLE_FILES_URL}/${encodeURIComponent(completedFileId)}?fields=id,modifiedTime`,
        { headers: { Authorization: `Bearer ${upload.accessToken}` } },
      );
      if (metadataResponse.ok) {
        const metadata = (await metadataResponse.json()) as GoogleFile;
        modifiedTime = metadata.modifiedTime;
      }
    }
    if (!modifiedTime) {
      return sendError(res, 502, "Backup ZIP tersimpan, tetapi waktu perubahannya belum dapat dikonfirmasi.");
    }

    await updateDriveFileId(connection.device_id, completedFileId);
    upload.result = { modifiedTime };
    upload.nextChunkIndex = upload.totalChunks;
    return res.json(upload.result);
  } catch (error) {
    if (error instanceof GoogleBackupError) return sendError(res, error.status, error.message);
    return sendError(res, 502, error instanceof Error ? error.message : "Backup ZIP Google Drive belum berhasil.");
  }
});

export default router;