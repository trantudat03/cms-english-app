const jwt = require('jsonwebtoken');

const getRequiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    const err: any = new Error(`Missing required env var: ${name}`);
    err.status = 500;
    throw err;
  }
  return value;
};

const verifyAccessToken = (token: string) => {
  const secret = getRequiredEnv('ACCESS_TOKEN_SECRET');
  return jwt.verify(token, secret);
};

const extractBearer = (authorizationHeader: unknown) => {
  if (typeof authorizationHeader !== 'string') return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
};

export default (_config: unknown, { strapi }: { strapi: unknown }) => {
  return async (ctx: any, next: any) => {
    const restPrefix =
      typeof (strapi as any)?.config?.get === 'function' ? String((strapi as any).config.get('api.rest.prefix') || '/api') : '/api';
    const requestPath = String(ctx?.request?.path ?? '');
    if (!requestPath.startsWith(restPrefix)) return await next();

    const authorization = ctx?.request?.header?.authorization;
    if (!authorization) return await next();

    const token = extractBearer(authorization);
    if (!token) ctx.throw(401, 'Unauthorized');

    let payload: any;
    try {
      payload = verifyAccessToken(token);
    } catch (e: any) {
      if (e && e.status === 500) ctx.throw(500, e.message);
      ctx.throw(401, 'Unauthorized');
    }

    const userId = Number(payload?.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      ctx.throw(401, 'Unauthorized');
    }

    ctx.state.user = { ...(ctx.state.user ?? {}), id: userId, role: payload?.role ?? null };

    return await next();
  };
};
