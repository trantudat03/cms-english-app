const jwt = require('jsonwebtoken');
import { randomUUID } from 'crypto';

const REFRESH_COOKIE_NAME = 'refreshToken';

const getRequiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required env var: ${name}`);
    // @ts-ignore
    err.status = 500;
    throw err;
  }
  return value;
};

const getRestPrefix = (strapi: any) => {
  const prefix = typeof strapi?.config?.get === 'function' ? strapi.config.get('api.rest.prefix') : undefined;
  return typeof prefix === 'string' && prefix.length > 0 ? prefix : '/api';
};

const getRefreshCookiePath = (strapi: any) => `${getRestPrefix(strapi)}/auth/refresh`;

const isRequestSecure = (ctx: any) => {
  const forwardedProto = String(ctx?.headers?.['x-forwarded-proto'] ?? '').toLowerCase();
  if (forwardedProto === 'https') return true;
  if (Boolean(ctx?.request?.secure)) return true;
  return process.env.NODE_ENV === 'production';
};

const setRefreshCookie = (ctx: any, strapi: any, token: string, expiresAt: Date | null) => {
  ctx.cookies.set(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isRequestSecure(ctx),
    sameSite: 'strict',
    path: getRefreshCookiePath(strapi),
    ...(expiresAt ? { expires: expiresAt } : {}),
  });
};

const signAccessToken = ({ userId, role }: { userId: number; role: string | null }) => {
  const secret = getRequiredEnv('ACCESS_TOKEN_SECRET');
  const expiresIn = process.env.ACCESS_TOKEN_EXPIRES || '10m';
  return jwt.sign({ userId, role }, secret, { expiresIn });
};

const signRefreshToken = ({ userId }: { userId: number }) => {
  const secret = getRequiredEnv('REFRESH_TOKEN_SECRET');
  const expiresIn = process.env.REFRESH_TOKEN_EXPIRES || '7d';
  const jti = randomUUID();
  const token = jwt.sign({ userId, jti }, secret, { expiresIn });
  const decoded = jwt.decode(token) as any;
  const expiresAt =
    decoded && typeof decoded === 'object' && typeof decoded.exp === 'number' ? new Date(decoded.exp * 1000) : null;
  return { token, jti, expiresAt };
};

export default (_config: unknown, { strapi }: { strapi: any }) => {
  return async (ctx: any, next: any) => {
    await next();

    const restPrefix = getRestPrefix(strapi);
    const isLocalLogin =
      String(ctx?.request?.method).toUpperCase() === 'POST' &&
      String(ctx?.request?.path) === `${restPrefix}/auth/local` &&
      ctx?.status === 200 &&
      ctx?.body &&
      typeof ctx.body === 'object' &&
      ctx.body.user &&
      typeof ctx.body.user?.id !== 'undefined';

    if (!isLocalLogin) return;

    const userId = Number(ctx.body.user.id);
    if (!Number.isFinite(userId) || userId <= 0) return;

    const role = ctx.body.user?.role?.type ?? ctx.body.user?.role?.name ?? null;
    const accessToken = signAccessToken({ userId, role });
    const { token: refreshToken, expiresAt } = signRefreshToken({ userId });

    await strapi.entityService.create('api::refresh-token.refresh-token', {
      data: {
        user: userId,
        token: refreshToken,
        expiresAt: expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revoked: false,
      },
    });

    setRefreshCookie(ctx, strapi, refreshToken, expiresAt);
    ctx.body = { ...(ctx.body as any), jwt: accessToken };
  };
}
