export const googleLoginCancelledMessage = 'Login Google dibatalkan.';
export const googleLoginFailureMessage = 'Login Google Drive belum berhasil. Periksa izin OAuth lalu coba lagi.';
export const googleLogoutFailureMessage = 'Logout belum selesai karena server tidak dapat mencabut sesi. Coba lagi saat koneksi stabil.';

export function getGoogleAuthResponseError(responseType: string) {
  if (responseType === 'cancel' || responseType === 'dismiss') {
    return googleLoginCancelledMessage;
  }
  return googleLoginFailureMessage;
}

export async function logoutGoogleAccount(input: {
  sessionToken: string | null;
  deviceId: string;
  disconnect: () => Promise<void>;
  clearLocalSession: () => Promise<void>;
  isUnauthorized: (reason: unknown) => boolean;
  onFailure: (message: string) => void;
}) {
  if (input.sessionToken && input.deviceId) {
    try {
      await input.disconnect();
    } catch (reason) {
      if (input.isUnauthorized(reason)) {
        await input.clearLocalSession();
        return;
      }
      input.onFailure(googleLogoutFailureMessage);
      throw new Error(googleLogoutFailureMessage);
    }
  }
  await input.clearLocalSession();
}