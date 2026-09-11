export * from "./generated/api";
export * from "./generated/api.schemas";
import { customFetch } from "./custom-fetch";

export {
  ApiError,
  setBaseUrl,
  setAuthTokenGetter,
} from "./custom-fetch";
export type { AuthTokenGetter } from "./custom-fetch";

type GoogleRequestOptions = RequestInit | undefined;

export type GoogleConnection = {
  email: string;
};

export type GoogleSession = {
  sessionToken: string;
  expiresAt: string;
  email: string;
};

export type GoogleDriveBackup = {
  content: string;
  modifiedTime: string | null;
};

export type GoogleDriveUpload = {
  content: string;
  expectedModifiedTime: string | null;
};

export type GoogleDriveUploadResult = {
  modifiedTime: string;
};

export async function getGoogleConnection(
  options?: GoogleRequestOptions,
): Promise<GoogleConnection> {
  return customFetch<GoogleConnection>("/api/google/connection", {
    ...options,
    method: "GET",
    responseType: "json",
  });
}

export async function connectGoogleAccount(
  input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    deviceId: string;
  },
  options?: GoogleRequestOptions,
): Promise<GoogleSession> {
  return customFetch<GoogleSession>("/api/google/connect", {
    ...options,
    method: "POST",
    body: JSON.stringify(input),
    responseType: "json",
  });
}

export async function disconnectGoogleAccount(
  options?: GoogleRequestOptions,
): Promise<void> {
  await customFetch<null>("/api/google/connection", {
    ...options,
    method: "DELETE",
    responseType: "json",
  });
}

export async function downloadGoogleDriveBackup(
  options?: GoogleRequestOptions,
): Promise<GoogleDriveBackup> {
  return customFetch<GoogleDriveBackup>("/api/google/backup", {
    ...options,
    method: "GET",
    responseType: "json",
  });
}

export async function uploadGoogleDriveBackup(
  input: GoogleDriveUpload,
  options?: GoogleRequestOptions,
): Promise<GoogleDriveUploadResult> {
  // Always use the chunk endpoint. The public proxy can reject a complete
  // backup before it reaches Express, including backups that are small enough
  // for Express's larger JSON limit.
  const chunkSize = 48 * 1024;
  const uploadId = `backup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const totalChunks = Math.max(1, Math.ceil(input.content.length / chunkSize));
  let finalResult: GoogleDriveUploadResult | null = null;

  for (let index = 0; index < totalChunks; index += 1) {
    const headers = new Headers(options?.headers);
    headers.set("X-Backup-Upload-ID", uploadId);
    headers.set("X-Backup-Chunk-Index", String(index));
    headers.set("X-Backup-Chunk-Total", String(totalChunks));

    const result = await customFetch<GoogleDriveUploadResult | { complete: false }>(
      "/api/google/backup/chunk",
      {
        ...options,
        method: "PUT",
        headers,
        body: JSON.stringify({
          content: input.content.slice(index * chunkSize, (index + 1) * chunkSize),
          expectedModifiedTime: input.expectedModifiedTime,
        }),
        responseType: "json",
      },
    );
    if ("modifiedTime" in result) finalResult = result;
  }

  if (finalResult) return finalResult;
  throw new Error("Backup Google Drive belum selesai diproses.");
}
