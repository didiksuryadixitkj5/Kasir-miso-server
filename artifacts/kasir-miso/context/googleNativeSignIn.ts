export async function getGoogleDriveServerAuthCode(_webClientId: string): Promise<string | null> {
  throw new Error('Native Google Sign-In hanya tersedia di aplikasi Android.');
}
