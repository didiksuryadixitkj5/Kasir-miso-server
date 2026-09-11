/**
 * The published API URL is the fallback used by standalone APK builds.
 * APK builds do not receive Replit's development-only domain variables.
 */
export const DEFAULT_API_BASE_URL = 'https://kasir-miso-server--hyha444.replit.app';

export function getApiBaseUrl() {
  const explicitApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (explicitApiBaseUrl) return explicitApiBaseUrl.replace(/\/+$/, '');

  const developmentApiDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (developmentApiDomain) {
    return `https://${developmentApiDomain}`.replace(/\/+$/, '');
  }

  return DEFAULT_API_BASE_URL;
}