// Keep this route test out of the API production TypeScript build.
// @ts-nocheck
import express from "express";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

type Connection = {
  device_id: string;
  email: string;
  client_id: string;
  encrypted_refresh_token: string;
  drive_file_id: string | null;
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

import googleRouter from "./google";

const nativeFetch = globalThis.fetch;
const tokenResponses: Array<Record<string, unknown>> = [];
const userinfoResponses: Array<Record<string, unknown>> = [];
const driveRequests: string[] = [];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const googleFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://oauth2.googleapis.com/token") {
    const body = new URLSearchParams(String(init?.body ?? ""));
    driveRequests.push(`token:${body.get("refresh_token") ?? ""}`);
    return jsonResponse(tokenResponses.shift() ?? {});
  }
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
    return jsonResponse(userinfoResponses.shift() ?? {});
  }
  driveRequests.push(url);
  if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
    return jsonResponse({ files: [{ id: "drive-file-b", name: "Kasir Miso Backup.json", modifiedTime: "2026-09-04T10:00:00.000Z" }] });
  }
  if (url.endsWith("/drive-file-b?alt=media")) {
    return new Response('{"storage":{}}', { status: 200 });
  }
  return jsonResponse({ id: "unexpected-file" });
});

const app = express();
app.use(express.json());
app.use(googleRouter);
const server = app.listen(0);
const address = server.address();
if (!address || typeof address === "string") throw new Error("Test server did not open a TCP port.");
const baseUrl = `http://127.0.0.1:${address.port}`;

async function apiRequest(path: string, init?: RequestInit) {
  return nativeFetch(`${baseUrl}${path}`, init);
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

afterAll(async () => {
  vi.stubGlobal("fetch", nativeFetch);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});