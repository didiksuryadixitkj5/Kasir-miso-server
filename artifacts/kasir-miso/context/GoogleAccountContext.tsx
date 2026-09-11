import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Google from 'expo-auth-session/providers/google';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { getApiBaseUrl } from '@/config/runtime';
import {
  ApiError,
  connectGoogleAccount,
  disconnectGoogleAccount,
  downloadGoogleDriveBackup,
  getGoogleConnection,
  setAuthTokenGetter,
  uploadGoogleDriveBackup,
} from '@workspace/api-client-react';
import {
  getGoogleAuthResponseError,
  logoutGoogleAccount,
} from './googleAccountPolicy';
import { GOOGLE_SESSION_TOKEN_KEY } from './onlineBackupMetadata';

WebBrowser.maybeCompleteAuthSession();

export {
  getGoogleAuthResponseError,
  googleLoginCancelledMessage,
  googleLoginFailureMessage,
  googleLogoutFailureMessage,
  logoutGoogleAccount,
} from './googleAccountPolicy';
export { GOOGLE_SESSION_TOKEN_KEY } from './onlineBackupMetadata';
const GOOGLE_SESSION_EXPIRY_KEY = 'warung-google-server-session-expiry-v1';
const GOOGLE_DEVICE_ID_KEY = 'warung-google-device-id-v1';
const GOOGLE_OAUTH_VERIFIER_KEY = 'warung-google-oauth-verifier-v1';
const LEGACY_GOOGLE_CONNECTION_KEY = 'warung-google-connection-v1';
const GOOGLE_ACCOUNT_EMAIL_KEY = 'warung-google-account-email-v1';
const GOOGLE_CLIENT_IDS_KEY = 'warung-google-client-ids-v1';
const WEB_PERSISTENT_SESSION_KEYS = new Set([
  GOOGLE_SESSION_TOKEN_KEY,
  GOOGLE_SESSION_EXPIRY_KEY,
  GOOGLE_DEVICE_ID_KEY,
]);
const GOOGLE_CLIENT_ID_FALLBACK = 'google-client-id-not-configured';
export type GoogleClientIds = {
  web: string;
  ios: string;
  android: string;
};
const configuredGoogleClientIds = (Constants.expoConfig?.extra?.googleClientIds ?? {}) as Partial<GoogleClientIds>;
const defaultGoogleClientIds: GoogleClientIds = {
  web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || configuredGoogleClientIds.web || '',
  ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || configuredGoogleClientIds.ios || '',
  android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || configuredGoogleClientIds.android || '',
};
const nativeGoogleRedirectUri = 'com.kasirwarung.app:/oauthredirect';

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || configuredGoogleClientIds.web || GOOGLE_CLIENT_ID_FALLBACK;
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || configuredGoogleClientIds.ios || GOOGLE_CLIENT_ID_FALLBACK;
const googleAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || configuredGoogleClientIds.android || GOOGLE_CLIENT_ID_FALLBACK;

type StoredGoogleClientIds = {
  web?: string;
  ios?: string;
  android?: string;
};
const googleServerConfigured = Boolean(
  getApiBaseUrl(),
);

type GoogleAccountContextValue = {
  isConnected: boolean;
  email: string;
  hydrated: boolean;
  connectionGeneration: number;
  hasDriveAccess: boolean;
  authError: string;
  request: ReturnType<typeof Google.useAuthRequest>[0];
  promptAsync: ReturnType<typeof Google.useAuthRequest>[2];
  clientConfigured: boolean;
  clientIdsComplete: boolean;
  googleClientIds: GoogleClientIds;
  saveGoogleClientIds: (clientIds: GoogleClientIds) => Promise<void>;
  serverConfigured: boolean;
  uploadDriveBackup: (content: string, expectedModifiedTime: string | null) => Promise<{ modifiedTime: string }>;
  downloadDriveBackup: () => Promise<{ content: string; modifiedTime: string | null }>;
  logout: () => Promise<void>;
};

const GoogleAccountContext = createContext<GoogleAccountContextValue | null>(null);

const reconnectMessage = 'Koneksi Google Drive berakhir. Hubungkan ulang akun Google untuk melanjutkan backup.';

async function withTransientDriveRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (reason) {
      const isTransient = reason instanceof ApiError && [502, 503, 504].includes(reason.status);
      if (!isTransient || attempt === 2) throw reason;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw new Error('Koneksi Google Drive belum berhasil.');
}

async function getProtectedItem(key: string) {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return null;
    const storage = WEB_PERSISTENT_SESSION_KEYS.has(key) ? window.localStorage : window.sessionStorage;
    const value = storage.getItem(key);
    if (value !== null || storage === window.sessionStorage) return value;

    // Migrate sessions created by the previous web preview, which used
    // sessionStorage and could lose the device identity when the preview
    // recreated its document while changing routes.
    const legacyValue = window.sessionStorage.getItem(key);
    if (legacyValue !== null) window.localStorage.setItem(key, legacyValue);
    return legacyValue;
  }
  return SecureStore.getItemAsync(key);
}

async function setProtectedItem(key: string, value: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      const storage = WEB_PERSISTENT_SESSION_KEYS.has(key) ? window.localStorage : window.sessionStorage;
      storage.setItem(key, value);
    }
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function removeProtectedItem(key: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

function createDeviceId() {
  return `device-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function GoogleAccountProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [email, setEmail] = useState('');
  const [googleClientIds, setGoogleClientIds] = useState<GoogleClientIds>(defaultGoogleClientIds);
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [authError, setAuthError] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const authResponseHandled = useRef(false);
  const authAttemptActive = useRef(false);
  const latestAuthResponse = useRef<typeof response>(null);
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: googleClientIds.web || googleWebClientId,
    iosClientId: googleClientIds.ios || googleIosClientId,
    androidClientId: googleClientIds.android || googleAndroidClientId,
    redirectUri: Platform.OS === 'web' ? undefined : nativeGoogleRedirectUri,
    scopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/drive.file'],
    responseType: 'code',
    shouldAutoExchangeCode: false,
    extraParams: {
      access_type: 'offline',
      prompt: 'select_account consent',
    },
  });

  const promptGoogleAsync = useCallback<ReturnType<typeof Google.useAuthRequest>[2]>(async (...args) => {
    // Expo can keep the previous response object around while a new browser
    // session is opening. Block that old response until a new one arrives.
    // The response effect below re-enables handling only for the new object.
    authAttemptActive.current = true;
    authResponseHandled.current = true;
    setAuthError('');
    if (request?.codeVerifier) {
      await setProtectedItem(GOOGLE_OAUTH_VERIFIER_KEY, request.codeVerifier);
    }
    return promptAsync(...args);
  }, [promptAsync, request]);

  const clearLocalSession = useCallback(async (message = '') => {
    const cleanupResults = await Promise.allSettled([
      removeProtectedItem(GOOGLE_SESSION_TOKEN_KEY),
      removeProtectedItem(GOOGLE_SESSION_EXPIRY_KEY),
      removeProtectedItem(GOOGLE_OAUTH_VERIFIER_KEY),
      AsyncStorage.multiRemove([
        GOOGLE_SESSION_TOKEN_KEY,
        GOOGLE_ACCOUNT_EMAIL_KEY,
        LEGACY_GOOGLE_CONNECTION_KEY,
      ]),
    ]);
    setSessionToken(null);
    setIsConnected(false);
    setEmail('');
    setAuthError(message);
    if (cleanupResults.some((result) => result.status === 'rejected')) {
      throw new Error('Akun Google sudah dicabut, tetapi sesi lokal belum seluruhnya terhapus. Mulai ulang aplikasi lalu hubungkan kembali.');
    }
  }, []);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(GOOGLE_CLIENT_IDS_KEY),
      getProtectedItem(GOOGLE_SESSION_TOKEN_KEY),
      getProtectedItem(GOOGLE_SESSION_EXPIRY_KEY),
      getProtectedItem(GOOGLE_DEVICE_ID_KEY),
      AsyncStorage.getItem(GOOGLE_ACCOUNT_EMAIL_KEY),
      AsyncStorage.removeItem(LEGACY_GOOGLE_CONNECTION_KEY),
    ])
      .then(async ([savedClientIds, savedToken, savedExpiry, savedDeviceId, savedEmail]) => {
        if (savedClientIds) {
          try {
            const parsed = JSON.parse(savedClientIds) as StoredGoogleClientIds;
            setGoogleClientIds({
              web: parsed.web ?? defaultGoogleClientIds.web,
              ios: parsed.ios ?? defaultGoogleClientIds.ios,
              android: parsed.android ?? defaultGoogleClientIds.android,
            });
          } catch {
            await AsyncStorage.removeItem(GOOGLE_CLIENT_IDS_KEY);
          }
        }
        const activeDeviceId = savedDeviceId || createDeviceId();
        if (!savedDeviceId) await setProtectedItem(GOOGLE_DEVICE_ID_KEY, activeDeviceId);
        setDeviceId(activeDeviceId);
        const isExpired = !savedExpiry || Date.parse(savedExpiry) <= Date.now();
        if (!authResponseHandled.current && savedToken && !isExpired) {
          setSessionToken(savedToken);
          setEmail(savedEmail ?? '');
          setIsConnected(true);
        } else if (savedToken) {
          await clearLocalSession(reconnectMessage);
        }
      })
      .finally(() => setHydrated(true));
  }, [clearLocalSession]);

  useEffect(() => {
    setAuthTokenGetter(() => sessionToken);
    return () => setAuthTokenGetter(null);
  }, [sessionToken]);

  useEffect(() => {
    if (!hydrated || !sessionToken || !deviceId) return;
    let mounted = true;
    void getGoogleConnection({
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'X-Device-ID': deviceId,
      },
    })
      .then(async (connection) => {
        if (!mounted) return;
        setEmail(connection.email);
        setIsConnected(true);
        setAuthError('');
        await AsyncStorage.setItem(GOOGLE_ACCOUNT_EMAIL_KEY, connection.email);
      })
      .catch((reason) => {
        if (!mounted) return;
        if (reason instanceof ApiError && reason.status === 401) {
          void clearLocalSession(reconnectMessage);
          return;
        }
        setAuthError('Status Google Drive belum dapat diperiksa. Backup akan dicoba lagi saat server tersedia.');
      });
    return () => {
      mounted = false;
    };
  }, [clearLocalSession, deviceId, hydrated, sessionToken]);

  useEffect(() => {
    if (response === latestAuthResponse.current) return;
    latestAuthResponse.current = response;
    if (!response || !authAttemptActive.current) return;
    // A changed response belongs to the current prompt, unlike the response
    // that was already visible when the prompt opened.
    authResponseHandled.current = false;
    if (response.type !== 'success') {
      authResponseHandled.current = true;
      setAuthError(getGoogleAuthResponseError(response.type));
      return;
    }

    authResponseHandled.current = true;
    let mounted = true;
    void (async () => {
      const code = response.params.code;
      const savedCodeVerifier = await getProtectedItem(GOOGLE_OAUTH_VERIFIER_KEY);
      const codeVerifier = request?.codeVerifier || savedCodeVerifier;
      if (!code || !codeVerifier || !request || !deviceId) {
        if (mounted) {
          setAuthError('Google tidak mengembalikan kode aman untuk menghubungkan Drive. Coba lagi.');
        }
        return;
      }

      setAuthError('');
      try {
        const connection = await connectGoogleAccount({
          code,
          codeVerifier,
          redirectUri: request.redirectUri,
          clientId: request.clientId,
          deviceId,
        }, {
          headers: {
            ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
            'X-Device-ID': deviceId,
          },
        });
        await Promise.all([
          setProtectedItem(GOOGLE_SESSION_TOKEN_KEY, connection.sessionToken),
          setProtectedItem(GOOGLE_SESSION_EXPIRY_KEY, connection.expiresAt),
          removeProtectedItem(GOOGLE_OAUTH_VERIFIER_KEY),
          AsyncStorage.setItem(GOOGLE_ACCOUNT_EMAIL_KEY, connection.email),
        ]);
        if (!mounted) return;
        setSessionToken(connection.sessionToken);
        setEmail(connection.email);
        setIsConnected(true);
        setConnectionGeneration((generation) => generation + 1);
        setAuthError('');
      } catch (reason) {
        if (!mounted) return;
        setAuthError(
          reason instanceof Error
            ? reason.message
            : 'Koneksi Google Drive belum berhasil. Hubungkan ulang akun Google.',
        );
      }
    })();

    return () => {
      mounted = false;
    };
  }, [deviceId, request, response, sessionToken]);

  const saveGoogleClientIds = useCallback(async (clientIds: GoogleClientIds) => {
    const normalized: GoogleClientIds = {
      web: clientIds.web.trim(),
      ios: clientIds.ios.trim(),
      android: clientIds.android.trim(),
    };
    await AsyncStorage.setItem(GOOGLE_CLIENT_IDS_KEY, JSON.stringify(normalized));
    setGoogleClientIds(normalized);
    setAuthError('');
  }, []);

  const handleDriveError = useCallback(async (reason: unknown): Promise<never> => {
    if (reason instanceof ApiError && reason.status === 401) {
      await clearLocalSession(reconnectMessage);
      throw new Error(reconnectMessage);
    }
    throw reason;
  }, [clearLocalSession]);

  const uploadDriveBackup = useCallback(async (content: string, expectedModifiedTime: string | null) => {
    if (!sessionToken || !deviceId) throw new Error('Hubungkan akun Google Drive terlebih dahulu.');
    try {
      const uploaded = await withTransientDriveRetry(() => uploadGoogleDriveBackup(
          { content, expectedModifiedTime },
          {
            headers: {
              Authorization: `Bearer ${sessionToken}`,
              'X-Device-ID': deviceId,
            },
          },
        ));
      return { modifiedTime: uploaded.modifiedTime };
    } catch (reason) {
      return handleDriveError(reason);
    }
  }, [deviceId, handleDriveError, sessionToken]);

  const downloadDriveBackup = useCallback(async () => {
    if (!sessionToken || !deviceId) throw new Error('Hubungkan akun Google Drive terlebih dahulu.');
    try {
      const backup = await withTransientDriveRetry(() => downloadGoogleDriveBackup({
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'X-Device-ID': deviceId,
          },
        }));
      return backup;
    } catch (reason) {
      return handleDriveError(reason);
    }
  }, [deviceId, handleDriveError, sessionToken]);

  const logout = useCallback(async () => {
    await logoutGoogleAccount({
      sessionToken,
      deviceId,
      disconnect: async () => {
        await disconnectGoogleAccount({
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'X-Device-ID': deviceId,
          },
        });
      },
      clearLocalSession,
      isUnauthorized: (reason) => reason instanceof ApiError && reason.status === 401,
      onFailure: setAuthError,
    });
  }, [clearLocalSession, deviceId, sessionToken]);

  const value = useMemo<GoogleAccountContextValue>(() => ({
    isConnected,
    email,
    hydrated,
    connectionGeneration,
    hasDriveAccess: Boolean(sessionToken && isConnected),
    authError,
    request,
    promptAsync: promptGoogleAsync,
    clientConfigured: Boolean(
      Platform.OS === 'web'
        ? googleClientIds.web
        : Platform.OS === 'ios'
          ? googleClientIds.ios
          : Platform.OS === 'android'
            ? googleClientIds.android
            : false,
    ),
    clientIdsComplete: Boolean(googleClientIds.web && googleClientIds.ios && googleClientIds.android),
    googleClientIds,
    saveGoogleClientIds,
    serverConfigured: googleServerConfigured,
    uploadDriveBackup,
    downloadDriveBackup,
    logout,
  }), [
    authError,
    connectionGeneration,
    downloadDriveBackup,
    email,
    hydrated,
    isConnected,
    logout,
    promptGoogleAsync,
    request,
    googleClientIds,
    saveGoogleClientIds,
    sessionToken,
    uploadDriveBackup,
  ]);

  return <GoogleAccountContext.Provider value={value}>{children}</GoogleAccountContext.Provider>;
}

export function useGoogleAccount() {
  const context = useContext(GoogleAccountContext);
  if (!context) throw new Error('useGoogleAccount must be used within GoogleAccountProvider');
  return context;
}