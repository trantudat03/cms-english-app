import type { Core } from '@strapi/strapi';
import authService from '../services/auth';

export default {
  async register(ctx: any) {
    const { username, email, password } = ctx.request.body ?? {};
    if (typeof username !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      ctx.throw(400, 'username, email and password are required');
    }

    try {
      const result = await authService.register({ strapi, ctx }, { username, email, password });
      ctx.status = 201;
      ctx.body = {
        success: true,
        ...result,
        message: 'Verification email sent',
      };
    } catch (err: any) {
      ctx.throw(err.status ?? 500, err.message ?? 'Register failed');
    }
  },

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

  // Refresh endpoint: validates refresh token and returns a new access token.
  async refresh(ctx: any) {
    const { refreshToken } = ctx.request.body ?? {};
    if (typeof refreshToken !== 'string') {
      ctx.throw(400, 'refreshToken is required');
    }

    try {
      const { accessToken } = await authService.refresh({ strapi }, refreshToken);
      ctx.body = { accessToken, refreshToken };
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

  async verifyEmail(ctx: any) {
    const token = ctx.query?.token;
    if (typeof token !== 'string') {
      ctx.throw(400, 'token is required');
    }

    try {
      const { redirectUrl } = await authService.verifyEmail({ strapi }, token);
      if (redirectUrl) {
        ctx.redirect(redirectUrl);
        return;
      }
      ctx.body = { success: true };
    } catch (err: any) {
      const frontendUrl = process.env.FRONTEND_URL;
      if (typeof frontendUrl === 'string' && frontendUrl.trim() !== '') {
        const errorUrl = `${frontendUrl.replace(/\/+$/, '')}/auth/verified?status=error`;
        ctx.redirect(errorUrl);
        return;
      }
      ctx.throw(err.status ?? 500, err.message ?? 'Verify email failed');
    }
  },
};
