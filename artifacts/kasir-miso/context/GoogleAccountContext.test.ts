import { describe, expect, it, vi } from 'vitest';
import {
  getGoogleAuthResponseError,
  googleLoginCancelledMessage,
  googleLoginFailureMessage,
  googleLogoutFailureMessage,
  logoutGoogleAccount,
} from './googleAccountPolicy';

describe('Google account provider error decisions', () => {
  it('reports cancellation instead of treating a dismissed login as a failed OAuth grant', () => {
    expect(getGoogleAuthResponseError('cancel')).toBe(googleLoginCancelledMessage);
    expect(getGoogleAuthResponseError('dismiss')).toBe(googleLoginCancelledMessage);
  });

  it('keeps non-cancellation OAuth responses on the retryable login message', () => {
    expect(getGoogleAuthResponseError('error')).toBe(googleLoginFailureMessage);
    expect(getGoogleAuthResponseError('locked')).toBe(googleLoginFailureMessage);
  });

  it('surfaces a logout failure without clearing the local session', async () => {
    const clearLocalSession = vi.fn(async () => undefined);
    const onFailure = vi.fn();

    await expect(logoutGoogleAccount({
      sessionToken: 'session-a',
      deviceId: 'device-a',
      disconnect: async () => { throw new Error('server unavailable'); },
      clearLocalSession,
      isUnauthorized: () => false,
      onFailure,
    })).rejects.toThrow(googleLogoutFailureMessage);

    expect(onFailure).toHaveBeenCalledWith(googleLogoutFailureMessage);
    expect(clearLocalSession).not.toHaveBeenCalled();
  });

  it('clears local state when logout finds an already-revoked server session', async () => {
    const clearLocalSession = vi.fn(async () => undefined);

    await logoutGoogleAccount({
      sessionToken: 'session-a',
      deviceId: 'device-a',
      disconnect: async () => { throw new Error('expired'); },
      clearLocalSession,
      isUnauthorized: () => true,
      onFailure: vi.fn(),
    });

    expect(clearLocalSession).toHaveBeenCalledOnce();
  });
});