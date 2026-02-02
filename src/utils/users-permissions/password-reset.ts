import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';

const getTtlMs = () => {
  const raw = process.env.UP_RESET_PASSWORD_TOKEN_TTL_MINUTES;
  const minutes = raw ? Number(raw) : 60;
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 60;
  return safeMinutes * 60 * 1000;
};

const getNormalizedEmail = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
};

export const registerUsersPermissionsPasswordResetHardening = (strapi: Core.Strapi) => {
  const plugin = strapi.plugin('users-permissions');
  const auth = plugin?.controllers?.auth as
    | undefined
    | {
        forgotPassword?: (ctx: Context) => Promise<unknown>;
        resetPassword?: (ctx: Context) => Promise<unknown>;
      };

  if (!auth?.forgotPassword || !auth?.resetPassword) return;

  const originalForgotPassword = auth.forgotPassword.bind(auth);
  const originalResetPassword = auth.resetPassword.bind(auth);

  auth.forgotPassword = async (ctx: Context) => {
    const email = getNormalizedEmail((ctx.request.body as any)?.email);
    await originalForgotPassword(ctx);

    if (!email) return;

    const user = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { email },
      select: ['id', 'resetPasswordToken'],
    });

    if (!user?.resetPasswordToken) return;

    const expiresAt = new Date(Date.now() + getTtlMs());
    try {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: { resetPasswordTokenExpiresAt: expiresAt },
      });
    } catch (err) {
      strapi.log.warn('Unable to persist reset-password token expiry.');
    }
  };

  auth.resetPassword = async (ctx: Context) => {
    const code = (ctx.request.body as any)?.code;
    let userId: number | string | null = null;
    if (typeof code === 'string' && code.trim()) {
      const user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { resetPasswordToken: code },
        select: ['id', 'resetPasswordTokenExpiresAt'],
      });

      if (user?.id) {
        userId = user.id as any;
        const expiresAt = user.resetPasswordTokenExpiresAt
          ? new Date(user.resetPasswordTokenExpiresAt as any)
          : null;

        if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
          ctx.status = 400;
          ctx.body = { error: { message: 'Invalid or expired reset password code.' } };
          return;
        }
      }
    }

    await originalResetPassword(ctx);

    if (!userId) return;

    try {
      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: userId },
        data: {
          resetPasswordToken: null,
          resetPasswordTokenExpiresAt: null,
        },
      });
    } catch {
      strapi.log.warn('Unable to clear reset-password token after reset.');
    }
  };
};
