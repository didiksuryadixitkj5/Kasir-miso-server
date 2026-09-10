import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { Router, type IRouter, type Request } from "express";

const router: IRouter = Router();
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const GOOGLE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const BACKUP_FILE_NAME = "Kasir Miso Backup.json";
const SESSION_TTL_DAYS = 30;

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

let schemaPromise: Promise<unknown> | null = null;

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

  const response = await fetch(GOOGLE_TOKEN_URL, {
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
  const response = await fetch(GOOGLE_USERINFO_URL, {
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
  const response = await fetch(GOOGLE_TOKEN_URL, {
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
    const response = await fetch(`${GOOGLE_FILES_URL}/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) return (await response.json()) as GoogleFile;
  }
  const query = encodeURIComponent(`name = '${BACKUP_FILE_NAME.replaceAll("'", "\\'")}' and trashed = false`);
  const response = await fetch(`${GOOGLE_FILES_URL}?q=${query}&fields=files(id,name,modifiedTime)&pageSize=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as GoogleFilesResponse;
  return data.files?.[0] ?? null;
}

async function updateDriveFileId(deviceId: string, fileId: string) {
  await pool.query(
    "UPDATE google_connections SET drive_file_id = $1, updated_at = NOW() WHERE device_id = $2",
    [fileId, deviceId],
  );
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
    const response = await fetch(`${GOOGLE_FILES_URL}/${encodeURIComponent(file.id)}?alt=media`, {
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
    const accessToken = await getAccessToken(connection);
    const file = await findBackupFile(accessToken, connection.drive_file_id);
    if (file?.modifiedTime && typeof expectedModifiedTime === "string" && file.modifiedTime !== expectedModifiedTime) {
      return sendError(res, 409, "Backup Google Drive lebih baru ditemukan dari perangkat lain.");
    }

    let fileId = file?.id;
    let modifiedTime: string;
    if (fileId) {
      const response = await fetch(`${GOOGLE_UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: content,
      });
      if (!response.ok) return sendError(res, response.status, "Backup Google Drive belum dapat diperbarui.");
      const metadataResponse = await fetch(`${GOOGLE_FILES_URL}/${encodeURIComponent(fileId)}?fields=id,modifiedTime`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!metadataResponse.ok) {
        return sendError(
          res,
          502,
          "Backup Google Drive sudah diperbarui, tetapi waktu perubahannya belum dapat dikonfirmasi.",
        );
      }
      const updated = (await metadataResponse.json()) as GoogleFile;
      if (!updated.modifiedTime) {
        return sendError(
          res,
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
      const response = await fetch(`${GOOGLE_UPLOAD_URL}?uploadType=multipart&fields=id,modifiedTime`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      });
      const created = (await response.json()) as GoogleFile;
      if (!response.ok || !created.id) return sendError(res, response.status, "Backup Google Drive belum dapat dibuat.");
      fileId = created.id;
      if (!created.modifiedTime) {
        await updateDriveFileId(connection.device_id, created.id);
        return sendError(
          res,
          502,
          "Backup Google Drive sudah dibuat, tetapi waktu perubahannya belum dapat dikonfirmasi.",
        );
      }
      modifiedTime = created.modifiedTime;
    }
    if (fileId) await updateDriveFileId(connection.device_id, fileId);
    return res.json({ modifiedTime });
  } catch (error) {
    return sendError(res, 502, error instanceof Error ? error.message : "Backup Google Drive belum dapat disimpan.");
  }
});

export default router;