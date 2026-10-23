const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export async function getGoogleDriveServerAuthCode(webClientId: string): Promise<string | null> {
  try {
    const {
      GoogleOneTapSignIn,
      isNoSavedCredentialFoundResponse,
      isSuccessResponse,
    } = await import('react-native-nitro-google-signin');

    GoogleOneTapSignIn.configure({
      webClientId,
      offlineAccess: true,
      scopes: [DRIVE_FILE_SCOPE],
    });
    await GoogleOneTapSignIn.checkPlayServices();
    await GoogleOneTapSignIn.signOut();

    let response = await GoogleOneTapSignIn.signIn();
    if (isNoSavedCredentialFoundResponse(response)) {
      response = await GoogleOneTapSignIn.createAccount();
    }
    if (isNoSavedCredentialFoundResponse(response)) {
      response = await GoogleOneTapSignIn.presentExplicitSignIn();
    }
    if (!isSuccessResponse(response)) return null;

    const serverAuthCode = response.data.serverAuthCode;
    if (!serverAuthCode) {
      throw new Error('Google tidak memberikan server auth code. Periksa Web Client ID dan izin Drive.');
    }
    return serverAuthCode;
  } catch (error) {
    if (
      error instanceof Error
      && /(nitro|native module|not installed|not found|cannot find)/i.test(error.message)
    ) {
      throw new Error('Login Google native memerlukan development build APK; fitur ini tidak berjalan di Expo Go.');
    }
    throw error;
  }
}
