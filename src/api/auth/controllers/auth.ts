import type { Core } from '@strapi/strapi';
import authService from '../services/auth';

export default {
  // Login with identifier (email/username) and password.
  // On success, issues a short-lived access token (15m) and a long-lived refresh token.
  async login(ctx: any) {
    const { identifier, password } = ctx.request.body ?? {};
    if (typeof identifier !== 'string' || typeof password !== 'string') {
      ctx.throw(400, 'identifier and password are required');
    }

    try {
      const { accessToken, refreshToken } = await authService.login(
        { strapi },
        identifier,
        password
      );

      // Never expose hashed value; only return opaque refresh token to client
      ctx.body = { accessToken, refreshToken };
    } catch (err: any) {
      ctx.throw(err.status ?? 500, err.message ?? 'Login failed');
    }
  },

  // Refresh endpoint: rotates refresh token securely and returns new tokens.
  // Rotation prevents replay attacks; old token is atomically revoked before issuing new one.
  async refresh(ctx: any) {
    const { refreshToken } = ctx.request.body ?? {};
    if (typeof refreshToken !== 'string') {
      ctx.throw(400, 'refreshToken is required');
    }

    try {
      const { accessToken, refreshToken: newRefreshToken } = await authService.refresh(
        { strapi },
        refreshToken
      );

      ctx.body = { accessToken, refreshToken: newRefreshToken };
    } catch (err: any) {
      ctx.throw(err.status ?? 500, err.message ?? 'Refresh failed');
    }
  },

  // Logout endpoint: revokes the provided refresh token (session-specific revoke).
  // Does not affect other sessions/devices of the same user.
  async logout(ctx: any) {
    const { refreshToken } = ctx.request.body ?? {};
    if (typeof refreshToken !== 'string') {
      ctx.throw(400, 'refreshToken is required');
    }

    try {
      await authService.logout({ strapi }, refreshToken);
      ctx.body = { success: true };
    } catch (err: any) {
      ctx.throw(err.status ?? 500, err.message ?? 'Logout failed');
    }
  },
};
