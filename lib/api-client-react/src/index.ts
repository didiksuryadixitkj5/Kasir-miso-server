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

export type GoogleDriveArchiveInfo = {
  modifiedTime: string | null;
  size: number;
  name: string;
};

export type GoogleDriveArchiveUploadResult = {
  modifiedTime: string;
};

export async function getGoogleDriveArchiveInfo(
  options?: GoogleRequestOptions,
): Promise<GoogleDriveArchiveInfo> {
  return customFetch<GoogleDriveArchiveInfo>("/api/google/backup/archive/info", {
    ...options,
    method: "GET",
    responseType: "json",
  });
}

export async function downloadGoogleDriveArchive(
  options?: GoogleRequestOptions,
): Promise<Blob> {
  return customFetch<Blob>("/api/google/backup/archive", {
    ...options,
    method: "GET",
    responseType: "blob",
  });
}

export async function uploadGoogleDriveArchive(
  input: {
    bytes: Uint8Array;
    expectedModifiedTime: string | null;
  },
  options?: GoogleRequestOptions,
): Promise<GoogleDriveArchiveUploadResult> {
  const session = await customFetch<{
    uploadId: string;
    chunkSize: number;
    totalChunks: number;
  }>("/api/google/backup/archive", {
    ...options,
    method: "POST",
    headers: new Headers(options?.headers),
    body: JSON.stringify({
      totalBytes: input.bytes.byteLength,
      expectedModifiedTime: input.expectedModifiedTime,
    }),
    responseType: "json",
  });
  if (
    !session.uploadId
    || !Number.isInteger(session.chunkSize)
    || session.chunkSize < 1
    || !Number.isInteger(session.totalChunks)
    || session.totalChunks < 1
  ) {
    throw new Error("Sesi upload backup ZIP tidak valid.");
  }

  let chunkIndex = 0;
  let finalResult: GoogleDriveArchiveUploadResult | null = null;
  while (chunkIndex < session.totalChunks) {
    const start = chunkIndex * session.chunkSize;
    const end = Math.min(start + session.chunkSize, input.bytes.byteLength);
    const headers = new Headers(options?.headers);
    headers.set("Content-Type", "application/octet-stream");
    headers.set("X-Backup-Chunk-Index", String(chunkIndex));
    headers.set("X-Backup-Chunk-Total", String(session.totalChunks));
    const result = await customFetch<
      GoogleDriveArchiveUploadResult | { complete: false; nextChunkIndex: number }
    >(`/api/google/backup/archive/${encodeURIComponent(session.uploadId)}`, {
      ...options,
      method: "PUT",
      headers,
      body: input.bytes.slice(start, end) as unknown as BodyInit,
      responseType: "json",
    });

    if ("modifiedTime" in result) {
      finalResult = result;
      break;
    }
    if (
      result.complete !== false
      || !Number.isInteger(result.nextChunkIndex)
      || result.nextChunkIndex <= chunkIndex
      || result.nextChunkIndex > session.totalChunks
    ) {
      throw new Error("Potongan backup ZIP tidak diterima sesuai urutan.");
    }
    chunkIndex = result.nextChunkIndex;
  }

  if (finalResult) return finalResult;
  throw new Error("Backup ZIP Google Drive belum selesai diproses.");
}

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
  const start = await customFetch<{
    downloadId: string;
    totalChunks: number;
    modifiedTime: string | null;
  }>("/api/google/backup/chunk", {
    ...options,
    method: "GET",
    responseType: "json",
  });
  if (
    !start.downloadId
    || !Number.isInteger(start.totalChunks)
    || start.totalChunks < 1
  ) {
    throw new Error("Sesi restore Google Drive tidak valid.");
  }

  const parts: string[] = [];
  for (let index = 0; index < start.totalChunks; index += 1) {
    const chunk = await customFetch<{
      content: string;
      chunkIndex: number;
      totalChunks: number;
      modifiedTime: string | null;
    }>(
      `/api/google/backup/chunk?downloadId=${encodeURIComponent(start.downloadId)}&chunkIndex=${index}`,
      {
        ...options,
        method: "GET",
        responseType: "json",
      },
    );
    if (
      chunk.chunkIndex !== index
      || chunk.totalChunks !== start.totalChunks
      || typeof chunk.content !== "string"
    ) {
      throw new Error("Potongan restore Google Drive tidak lengkap.");
    }
    parts.push(chunk.content);
  }

  return {
    content: parts.join(""),
    modifiedTime: start.modifiedTime,
  };
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
