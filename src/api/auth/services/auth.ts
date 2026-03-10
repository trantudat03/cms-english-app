import type { Core } from '@strapi/strapi';
import * as crypto from 'crypto';
import emailService from '../../../services/email-service';

type StrapiCtx = { strapi: Core.Strapi; ctx?: any };

const ACCESS_TOKEN_EXPIRES = '15m';
const REFRESH_TOKEN_LIFESPAN_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_VERIFY_TOKEN_LIFESPAN_MS = 24 * 60 * 60 * 1000;

const toNowMs = () => Date.now();
const addMs = (ms: number) => new Date(toNowMs() + ms);

const hashToken = (token: string): string => {
  // Use SHA-256 to hash refresh tokens before storing; this avoids storing secrets in DB
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
};

const generateRefreshToken = (): string => {
  // Generate 64-byte cryptographically secure random string (hex-encoded => 128 chars)
  return crypto.randomBytes(64).toString('hex');
};

const generateEmailVerificationToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

const issueAccessToken = (strapi: Core.Strapi, userId: number): string => {
  // Issue JWT using users-permissions plugin with a strict 15-minute expiry
  const jwtService = strapi.plugin('users-permissions')?.service('jwt') as any;
  if (!jwtService || typeof jwtService.issue !== 'function') {
    throw new Error('JWT service unavailable');
  }
  return jwtService.issue({ id: userId }, { expiresIn: ACCESS_TOKEN_EXPIRES });
};

const getDefaultRoleId = async (strapi: Core.Strapi): Promise<number> => {
  const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' } as any);
  const advancedSettings = (await pluginStore.get({ key: 'advanced' } as any)) as any;
  const defaultRoleType = advancedSettings?.default_role;
  if (!defaultRoleType) {
    throw new Error('users-permissions default role is not configured');
  }

  const role = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: defaultRoleType },
    select: ['id'],
  } as any);

  if (!role?.id) {
    throw new Error('Default role not found');
  }

  return Number(role.id);
};

const normalizeBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (trimmed.toLowerCase().endsWith('/api')) return trimmed.slice(0, -4);
  return trimmed;
};

const getBackendBaseUrl = (strapi: Core.Strapi, ctx?: any) => {
  // 1) Prefer request origin if available (behind proxy requires correct trust/proxy headers)
  const originFromCtx =
    ctx?.request?.origin ||
    (ctx?.request?.protocol && ctx?.request?.host
      ? `${ctx.request.protocol}://${ctx.request.host}`
      : undefined);
  // 2) Then server.url from config
  const configured = strapi.config.get('server.url') as string | undefined;
  // 3) Then STRAPI_URL env
  const envUrl = process.env.STRAPI_URL;
  const base = originFromCtx || configured || envUrl || 'http://localhost:1337';
  return normalizeBaseUrl(base);
};

const createRefreshTokenRow = async (
  strapi: Core.Strapi,
  userId: number,
  tokenHash: string
) => {
  const expiresAtIso = addMs(REFRESH_TOKEN_LIFESPAN_MS).toISOString();
  return await strapi.entityService.create('api::refresh-token.refresh-token' as any, {
    data: {
      user: userId,
      tokenHash,
      expiresAt: expiresAtIso,
      isRevoked: false,
    } as any,
  });
};

export default {
  async register(
    { strapi, ctx }: StrapiCtx,
    payload: { username: string; email: string; password: string }
  ) {
    const username = String(payload.username || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '');

    if (!username || !email || !password) {
      const err: any = new Error('username, email and password are required');
      err.status = 400;
      throw err;
    }

    const existing = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        $or: [{ email }, { username }],
      },
      select: ['id'],
    } as any);
    if (existing?.id) {
      const err: any = new Error('Email or username already exists');
      err.status = 400;
      throw err;
    }

    const roleId = await getDefaultRoleId(strapi);

    const created = await strapi.entityService.create('plugin::users-permissions.user' as any, {
      data: {
        username,
        email,
        password,
        provider: 'local',
        confirmed: false,
        blocked: false,
        role: roleId,
      } as any,
      fields: ['id', 'email', 'username', 'confirmed'],
    } as any);

    const token = generateEmailVerificationToken();
    const tokenHash = hashToken(token);
    const expiresAtIso = addMs(EMAIL_VERIFY_TOKEN_LIFESPAN_MS).toISOString();

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: (created as any).id },
      data: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationTokenExpiresAt: expiresAtIso,
      },
    } as any);

    const backendBaseUrl = getBackendBaseUrl(strapi, ctx);
    const verificationLink = `${backendBaseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
    await emailService.sendVerificationEmail(created as any, verificationLink, { expiresHours: 24 });

    return {
      user: {
        id: (created as any).id,
        email: (created as any).email,
        username: (created as any).username,
        confirmed: (created as any).confirmed,
      },
    };
  },

  async verifyEmail({ strapi }: StrapiCtx, token: string) {
    if (typeof token !== 'string' || token.trim() === '') {
      const err: any = new Error('token is required');
      err.status = 400;
      throw err;
    }

    const tokenHash = hashToken(token);
    const nowIso = new Date().toISOString();

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        emailVerificationTokenHash: tokenHash,
        emailVerificationTokenExpiresAt: { $gt: nowIso },
      },
      select: ['id', 'email', 'username', 'confirmed'],
    } as any);

    if (!user?.id) {
      const err: any = new Error('Invalid or expired token');
      err.status = 400;
      throw err;
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: user.id },
      data: {
        confirmed: true,
        emailVerificationTokenHash: null,
        emailVerificationTokenExpiresAt: null,
      },
    } as any);

    await emailService.sendVerifiedSuccessEmail(user as any);

    const frontendUrl = process.env.FRONTEND_URL;
    if (typeof frontendUrl !== 'string' || frontendUrl.trim() === '') {
      return { redirectUrl: undefined };
    }

    const redirectUrl = `${frontendUrl.replace(/\/+$/, '')}/auth/verified`;
    return { redirectUrl };
  },

  async login({ strapi }: StrapiCtx, identifier: string, password: string) {
    // Authenticate using users-permissions without modifying the core plugin
    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        $or: [{ email: identifier }, { username: identifier }],
      },
    });
    if (!user) {
      const err: any = new Error('Invalid identifier or password');
      err.status = 400;
      throw err;
    }

    const userService = strapi.plugin('users-permissions')?.service('user') as any;
    if (!userService || typeof userService.validatePassword !== 'function') {
      throw new Error('User service unavailable');
    }
    const isValid = await userService.validatePassword(password, (user as any).password);
    if (!isValid) {
      const err: any = new Error('Invalid identifier or password');
      err.status = 400;
      throw err;
    }

    const accessToken = issueAccessToken(strapi, Number((user as any).id));

    // Generate and store a hashed refresh token
    const refreshToken = generateRefreshToken();
    const tokenHash = hashToken(refreshToken);
    await createRefreshTokenRow(strapi, Number((user as any).id), tokenHash);

    return { accessToken, refreshToken };
  },

  async refresh({ strapi }: StrapiCtx, incomingRefreshToken: string) {
    const tokenHash = hashToken(incomingRefreshToken);
    const now = new Date();

    const existing = await strapi.db.query('api::refresh-token.refresh-token').findOne({
      where: { tokenHash },
      populate: { user: { fields: ['id'] } },
    } as any);

    if (!existing) {
      const err: any = new Error('Invalid refresh token');
      err.status = 400;
      throw err;
    }
    if (existing.isRevoked) {
      const err: any = new Error('Refresh token has been revoked');
      err.status = 401;
      throw err;
    }
    if (new Date(existing.expiresAt) <= now) {
      await strapi.db.query('api::refresh-token.refresh-token').update({
        where: { id: existing.id },
        data: { isRevoked: true },
      } as any);

      const err: any = new Error('Refresh token expired');
      err.status = 401;
      throw err;
    }

    const userId = Number((existing as any).user?.id);
    const accessToken = issueAccessToken(strapi, userId);

    return { accessToken, refreshToken: incomingRefreshToken };
  },

  async logout({ strapi }: StrapiCtx, incomingRefreshToken: string) {
    const tokenHash = hashToken(incomingRefreshToken);

    const updated = await strapi.db.query('api::refresh-token.refresh-token').update({
      where: { tokenHash, isRevoked: false },
      data: { isRevoked: true },
    } as any);

    if (!updated) {
      const err: any = new Error('Invalid or already revoked refresh token');
      err.status = 400;
      throw err;
    }

    return { success: true };
  },
};
