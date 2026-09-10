// Keep this route test out of the API production TypeScript build.
// @ts-nocheck
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Connection = {
  device_id: string;
  email: string;
  client_id: string;
  encrypted_refresh_token: string;
  drive_file_id: string | null;
};

type DriveFile = {
  id: string;
  name?: string;
  modifiedTime?: string;
};

let connection: Connection | null = null;
let session: { hash: string; deviceId: string; expiresAt: Date } | null = null;

const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));

query.mockImplementation(async (sql: string, params: unknown[] = []) => {
  if (sql.includes("CREATE TABLE IF NOT EXISTS")) return { rows: [] };

  if (sql.includes("SELECT email, encrypted_refresh_token FROM google_connections")) {
    return {
      rows: connection
        ? [{ email: connection.email, encrypted_refresh_token: connection.encrypted_refresh_token }]
        : [],
    };
  }

  if (sql.includes("INSERT INTO google_connections")) {
    const [deviceId, email, clientId, encryptedRefreshToken] = params as [string, string, string, string];
    const changedAccount = connection && connection.email.toLowerCase() !== email.toLowerCase();
    connection = {
      device_id: deviceId,
      email,
      client_id: clientId,
      encrypted_refresh_token: encryptedRefreshToken,
      drive_file_id: changedAccount ? null : connection?.drive_file_id ?? null,
    };
    return { rows: [] };
  }

  if (sql.includes("DELETE FROM google_sessions")) {
    session = null;
    return { rows: [] };
  }

  if (sql.includes("INSERT INTO google_sessions")) {
    const [hash, deviceId, expiresAt] = params as [string, string, Date];
    session = { hash, deviceId, expiresAt };
    return { rows: [] };
  }

  if (sql.includes("SELECT c.device_id")) {
    const [sessionHash, deviceId] = params as [string, string];
    if (
      connection
      && session
      && session.hash === sessionHash
      && session.deviceId === deviceId
      && session.expiresAt.getTime() > Date.now()
    ) {
      return { rows: [{ ...connection, session_hash: session.hash }] };
    }
    return { rows: [] };
  }

  if (sql.includes("UPDATE google_connections SET drive_file_id")) {
    if (connection) connection.drive_file_id = params[0] as string;
    return { rows: [] };
  }

  throw new Error(`Unexpected query in test: ${sql}`);
});

vi.mock("@workspace/db", () => ({
  pool: { query },
}));

import app from "../app";

const nativeFetch = globalThis.fetch;
const tokenResponses: Array<Record<string, unknown>> = [];
const userinfoResponses: Array<Record<string, unknown>> = [];
const driveRequests: string[] = [];
const driveUploadBodies: Array<{ method: string; url: string; body: string }> = [];
let listedBackupFile: DriveFile | null | undefined;
let updatedBackupFile: DriveFile = {
  id: "drive-file-b",
  modifiedTime: "2026-09-04T10:00:00.000Z",
};
let backupFileLookupResponseStatus = 200;
let backupSearchResponseStatus = 200;
let updatedMetadataResponseStatus = 200;
let createdBackupFile: DriveFile = {
  id: "drive-file-created",
  modifiedTime: "2026-09-05T10:00:00.000Z",
};
let downloadedBackupContent = '{"storage":{}}';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const googleFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (url === "https://oauth2.googleapis.com/token") {
    const body = new URLSearchParams(String(init?.body ?? ""));
    driveRequests.push(`token:${body.get("refresh_token") ?? ""}`);
    return jsonResponse(tokenResponses.shift() ?? {});
  }
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
    return jsonResponse(userinfoResponses.shift() ?? {});
  }
  driveRequests.push(url);
  if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/")) {
    driveUploadBodies.push({
      method,
      url,
      body: String(init?.body ?? ""),
    });
    return jsonResponse({});
  }
  if (url === "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime") {
    driveUploadBodies.push({
      method,
      url,
      body: String(init?.body ?? ""),
    });
    return jsonResponse(createdBackupFile);
  }
  if (url.startsWith("https://www.googleapis.com/drive/v3/files/") && url.includes("?fields=id,name,modifiedTime")) {
    return jsonResponse(updatedBackupFile, backupFileLookupResponseStatus);
  }
  if (url.startsWith("https://www.googleapis.com/drive/v3/files/") && url.includes("?fields=id,modifiedTime")) {
    return jsonResponse(updatedBackupFile, updatedMetadataResponseStatus);
  }
  if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
    return jsonResponse({
      files: listedBackupFile === undefined
        ? [{ id: "drive-file-b", name: "Kasir Miso Backup.json", modifiedTime: "2026-09-04T10:00:00.000Z" }]
        : listedBackupFile
          ? [listedBackupFile]
          : [],
    }, backupSearchResponseStatus);
  }
  if (url.includes("?alt=media")) {
    return new Response(downloadedBackupContent, { status: 200 });
  }
  return jsonResponse({ id: "unexpected-file" });
});

const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Test server did not open a TCP port.");
const baseUrl = `http://127.0.0.1:${address.port}`;

async function apiRequest(path: string, init?: RequestInit) {
  return nativeFetch(`${baseUrl}/api${path}`, init);
}

const deviceId = "device-two-account-regression";
const clientId = "client-id";
const redirectUri = "com.kasirwarung.app:/oauthredirect";

function connectRequest(code: string, extraHeaders: Record<string, string> = {}) {
  return apiRequest("/google/connect", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Device-ID": deviceId, ...extraHeaders },
    body: JSON.stringify({
      code,
      codeVerifier: "verifier",
      redirectUri,
      clientId,
      deviceId,
    }),
  });
}

async function createValidGoogleSession() {
  tokenResponses.push({ access_token: "access-connect", refresh_token: "refresh-connect" });
  userinfoResponses.push({ email: "backup-owner@example.com" });
  const response = await connectRequest("backup-connect");
  expect(response.status).toBe(200);
  return (await response.json() as { sessionToken: string }).sessionToken;
}

describe("Google connection account isolation", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.GOOGLE_OAUTH_CLIENT_IDS = clientId;
    process.env.GOOGLE_OAUTH_WEB_CLIENT_ID = "";
    connection = null;
    session = null;
    query.mockClear();
    googleFetch.mockClear();
    tokenResponses.length = 0;
    userinfoResponses.length = 0;
    driveRequests.length = 0;
    driveUploadBodies.length = 0;
    listedBackupFile = undefined;
    updatedBackupFile = {
      id: "drive-file-b",
      modifiedTime: "2026-09-04T10:00:00.000Z",
    };
    backupFileLookupResponseStatus = 200;
    backupSearchResponseStatus = 200;
    updatedMetadataResponseStatus = 200;
    createdBackupFile = {
      id: "drive-file-created",
      modifiedTime: "2026-09-05T10:00:00.000Z",
    };
    downloadedBackupContent = '{"storage":{}}';
    vi.stubGlobal("fetch", googleFetch);
  });

  it("rejects a changed Google email when Google omits a refresh token", async () => {
    tokenResponses.push({ access_token: "access-a", refresh_token: "refresh-a" });
    userinfoResponses.push({ email: "owner-a@example.com" });
    const first = await connectRequest("code-a");
    expect(first.status).toBe(200);
    const firstSession = (await first.json()) as { sessionToken: string };
    const oldConnection = { ...connection! };
    connection!.drive_file_id = "drive-file-a";

    tokenResponses.push({ access_token: "access-b" });
    userinfoResponses.push({ email: "owner-b@example.com" });
    const switched = await connectRequest("code-b", {
      Authorization: `Bearer ${firstSession.sessionToken}`,
    });

    expect(switched.status).toBe(400);
    await expect(switched.json()).resolves.toMatchObject({
      message: expect.stringContaining("token Drive untuk akun baru"),
    });
    expect(connection).toEqual({
      ...oldConnection,
      drive_file_id: "drive-file-a",
    });
    expect(driveRequests).not.toContain("token:refresh-b");
  });

  it("replaces the token and clears the old Drive file when the account changes", async () => {
    tokenResponses.push({ access_token: "access-a", refresh_token: "refresh-a" });
    userinfoResponses.push({ email: "owner-a@example.com" });
    const first = await connectRequest("code-a");
    expect(first.status).toBe(200);
    connection!.drive_file_id = "drive-file-a";

    tokenResponses.push({ access_token: "access-b", refresh_token: "refresh-b" });
    userinfoResponses.push({ email: "OWNER-B@example.com" });
    const switched = await connectRequest("code-b");
    expect(switched.status).toBe(200);
    const switchedSession = (await switched.json()) as { sessionToken: string; email: string };

    expect(switchedSession.email).toBe("OWNER-B@example.com");
    expect(connection?.email).toBe("OWNER-B@example.com");
    expect(connection?.drive_file_id).toBeNull();
    expect(connection?.encrypted_refresh_token).not.toBeNull();

    tokenResponses.push({ access_token: "access-b-drive" });
    const backup = await apiRequest("/google/backup", {
      headers: {
        Authorization: `Bearer ${switchedSession.sessionToken}`,
        "X-Device-ID": deviceId,
      },
    });

    expect(backup.status).toBe(200);
    expect(driveRequests).toContain("token:refresh-b");
    expect(driveRequests).not.toContain("https://www.googleapis.com/drive/v3/files/drive-file-a?fields=id,name,modifiedTime");
    expect(driveRequests.some((url) => url.startsWith("https://www.googleapis.com/drive/v3/files?q="))).toBe(true);
  });
});

describe("Google backup upload persistence", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.GOOGLE_OAUTH_CLIENT_IDS = clientId;
    process.env.GOOGLE_OAUTH_WEB_CLIENT_ID = "";
    connection = null;
    session = null;
    query.mockClear();
    googleFetch.mockClear();
    tokenResponses.length = 0;
    userinfoResponses.length = 0;
    driveRequests.length = 0;
    driveUploadBodies.length = 0;
    listedBackupFile = undefined;
    updatedBackupFile = {
      id: "drive-file-b",
      modifiedTime: "2026-09-04T10:00:00.000Z",
    };
    backupFileLookupResponseStatus = 200;
    backupSearchResponseStatus = 200;
    createdBackupFile = {
      id: "drive-file-created",
      modifiedTime: "2026-09-05T10:00:00.000Z",
    };
    downloadedBackupContent = '{"storage":{}}';
    vi.stubGlobal("fetch", googleFetch);
  });

  it("preserves a large backup body when updating an existing Drive file", async () => {
    const sessionToken = await createValidGoogleSession();
    connection!.drive_file_id = "drive-file-existing";
    const content = JSON.stringify({
      storage: {
        image: "data:image/jpeg;base64," + "A".repeat(128 * 1024),
      },
    });
    const expectedModifiedTime = "2026-09-04T10:00:00.000Z";
    tokenResponses.push({ access_token: "access-drive" });
    updatedBackupFile = { id: "drive-file-existing", modifiedTime: expectedModifiedTime };

    const response = await apiRequest("/google/backup", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-Device-ID": deviceId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content, expectedModifiedTime }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ modifiedTime: expectedModifiedTime });
    expect(driveUploadBodies).toHaveLength(1);
    expect(driveUploadBodies[0]).toMatchObject({
      method: "PATCH",
      url: "https://www.googleapis.com/upload/drive/v3/files/drive-file-existing?uploadType=media",
      body: content,
    });
    expect(driveRequests.filter((url) => url.includes("?fields=id,modifiedTime"))).toHaveLength(1);
    expect(connection?.drive_file_id).toBe("drive-file-existing");
  });

  it("does not create a duplicate when Drive cannot confirm an old backup file", async () => {
    const sessionToken = await createValidGoogleSession();
    const staleFileId = "drive-file-stale";
    connection!.drive_file_id = staleFileId;
    backupFileLookupResponseStatus = 404;
    backupSearchResponseStatus = 503;
    tokenResponses.push({ access_token: "access-drive" });

    const response = await apiRequest("/google/backup", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-Device-ID": deviceId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: '{"storage":{}}' }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      message: "Status backup Google Drive belum dapat dipastikan. Coba lagi saat koneksi Google Drive tersedia.",
    });
    expect(driveUploadBodies).toHaveLength(0);
    expect(connection?.drive_file_id).toBe(staleFileId);
  });

  it("reports when updated Drive metadata cannot be confirmed", async () => {
    const sessionToken = await createValidGoogleSession();
    connection!.drive_file_id = "drive-file-existing";
    tokenResponses.push({ access_token: "access-drive" });
    updatedBackupFile = { id: "drive-file-existing", modifiedTime: "2026-09-07T10:00:00.000Z" };
    updatedMetadataResponseStatus = 503;

    const response = await apiRequest("/google/backup", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-Device-ID": deviceId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: '{"storage":{}}' }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      message: "Backup Google Drive sudah diperbarui, tetapi waktu perubahannya belum dapat dikonfirmasi.",
    });
    expect(driveUploadBodies).toHaveLength(1);
    expect(driveRequests.filter((url) => url.includes("?fields=id,modifiedTime"))).toHaveLength(1);
  });

  it("preserves a large backup body when creating a new Drive file", async () => {
    const sessionToken = await createValidGoogleSession();
    const content = JSON.stringify({
      storage: {
        image: "data:image/png;base64," + "B".repeat(128 * 1024),
      },
    });
    listedBackupFile = null;
    tokenResponses.push({ access_token: "access-drive" });

    const response = await apiRequest("/google/backup", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-Device-ID": deviceId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      modifiedTime: createdBackupFile.modifiedTime,
    });
    expect(driveUploadBodies).toHaveLength(1);
    expect(driveUploadBodies[0].method).toBe("POST");
    expect(driveUploadBodies[0].url).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime",
    );
    expect(driveUploadBodies[0].body).toContain(content);
    expect(driveRequests.filter((url) => url.includes("?fields=id,modifiedTime"))).toHaveLength(0);
    expect(connection?.drive_file_id).toBe(createdBackupFile.id);
  });

  it("reports when a newly created Drive file has no confirmed modified time", async () => {
    const sessionToken = await createValidGoogleSession();
    const content = '{"storage":{}}';
    listedBackupFile = null;
    createdBackupFile = { id: "drive-file-created-without-time" };
    tokenResponses.push({ access_token: "access-drive" });

    const response = await apiRequest("/google/backup", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-Device-ID": deviceId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      message: "Backup Google Drive sudah dibuat, tetapi waktu perubahannya belum dapat dikonfirmasi.",
    });
    expect(driveUploadBodies).toHaveLength(1);
    expect(connection?.drive_file_id).toBe(createdBackupFile.id);
  });

  it("returns the complete large backup body and its Drive modified time", async () => {
    const sessionToken = await createValidGoogleSession();
    const fileId = "drive-file-large-download";
    const modifiedTime = "2026-09-06T10:00:00.000Z";
    const content = JSON.stringify({
      format: "kasir-miso-online-backup",
      version: 1,
      createdAt: "2026-09-06T09:55:00.000Z",
      storage: {
        qrisImageUri: "data:image/png;base64," + "C".repeat(256 * 1024),
      },
    });
    connection!.drive_file_id = fileId;
    updatedBackupFile = { id: fileId, modifiedTime };
    downloadedBackupContent = content;
    tokenResponses.push({ access_token: "access-drive" });

    const response = await apiRequest("/google/backup", {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "X-Device-ID": deviceId,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      content,
      modifiedTime,
    });
    expect(driveRequests).toContain(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    );
    expect(connection?.drive_file_id).toBe(fileId);
  });
});

describe("Google backup request size handling", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.GOOGLE_OAUTH_CLIENT_IDS = clientId;
    process.env.GOOGLE_OAUTH_WEB_CLIENT_ID = "";
    connection = null;
    session = null;
    query.mockClear();
    googleFetch.mockClear();
    tokenResponses.length = 0;
    userinfoResponses.length = 0;
    driveRequests.length = 0;
    driveUploadBodies.length = 0;
    listedBackupFile = undefined;
    downloadedBackupContent = '{"storage":{}}';
    vi.stubGlobal("fetch", googleFetch);
  });

  it("accepts a backup body larger than 100 KB before returning structured auth errors", async () => {
    const response = await apiRequest("/google/backup", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(128 * 1024) }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      message: "Sesi Google tidak ditemukan atau sudah kedaluwarsa.",
    });
  });

  it("returns a displayable JSON error when the backup exceeds the safe request limit", async () => {
    const response = await apiRequest("/google/backup", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(25 * 1024 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      message: "Backup terlalu besar untuk dikirim. Hapus gambar yang tidak diperlukan lalu coba lagi.",
    });
  });
});

afterAll(async () => {
  vi.stubGlobal("fetch", nativeFetch);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});