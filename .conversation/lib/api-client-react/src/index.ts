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
  return customFetch<GoogleDriveUploadResult>("/api/google/backup", {
    ...options,
    method: "PUT",
    body: JSON.stringify(input),
    responseType: "json",
  });
}
