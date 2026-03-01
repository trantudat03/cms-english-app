import type { Core } from '@strapi/strapi';
import * as crypto from 'crypto';

type StrapiCtx = { strapi: Core.Strapi };

const ACCESS_TOKEN_EXPIRES = '15m';
const REFRESH_TOKEN_LIFESPAN_MS = 30 * 24 * 60 * 60 * 1000;

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

const issueAccessToken = (strapi: Core.Strapi, userId: number): string => {
  // Issue JWT using users-permissions plugin with a strict 15-minute expiry
  const jwtService = strapi.plugin('users-permissions')?.service('jwt') as any;
  if (!jwtService || typeof jwtService.issue !== 'function') {
    throw new Error('JWT service unavailable');
  }
  return jwtService.issue({ id: userId }, { expiresIn: ACCESS_TOKEN_EXPIRES });
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

    const result = await strapi.db.transaction(async () => {
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
        const err: any = new Error('Refresh token expired');
        err.status = 401;
        throw err;
      }

      const updated = await strapi.db.query('api::refresh-token.refresh-token').update({
        where: { id: existing.id, isRevoked: false },
        data: { isRevoked: true },
      } as any);
      if (!updated) {
        const err: any = new Error('Refresh token already used');
        err.status = 409;
        throw err;
      }

      const userId = Number((existing as any).user?.id);
      const accessToken = issueAccessToken(strapi, userId);
      const newRefreshToken = generateRefreshToken();
      const newHash = hashToken(newRefreshToken);

      await strapi.db.query('api::refresh-token.refresh-token').create({
        data: {
          user: userId,
          tokenHash: newHash,
          expiresAt: addMs(REFRESH_TOKEN_LIFESPAN_MS).toISOString(),
          isRevoked: false,
        },
      } as any);

      return { accessToken, newRefreshToken };
    });

    return { accessToken: result.accessToken, refreshToken: result.newRefreshToken };
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
