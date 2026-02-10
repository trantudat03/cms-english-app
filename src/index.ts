import type { Core } from '@strapi/strapi';
import { randomUUID } from 'crypto';

const jwt: any = require('jsonwebtoken');

const USER_UID = 'plugin::users-permissions.user';
const USER_SAFE_POPULATE = {
  avatar: true,
  role: { fields: ['id', 'name', 'type'] },
};

const REFRESH_COOKIE_NAME = 'refreshToken';

const stripSensitiveUserFields = (user: unknown) => {
  if (user == null || typeof user !== 'object' || Array.isArray(user)) return user;

  const sanitized: Record<string, unknown> = { ...(user as Record<string, unknown>) };
  delete sanitized.password;
  delete sanitized.resetPasswordToken;
  delete sanitized.confirmationToken;
  return sanitized;
};

const stripSensitiveFromBody = (body: unknown) => {
  if (Array.isArray(body)) return body.map(stripSensitiveUserFields);
  if (body == null || typeof body !== 'object') return body;

  const record = body as Record<string, unknown>;
  if ('user' in record) {
    return { ...record, user: stripSensitiveUserFields(record.user) };
  }

  return stripSensitiveUserFields(record);
};

const sanitizeUserEntity = async (strapi: Core.Strapi, user: unknown, ctx: any) => {
  const schema = strapi.getModel(USER_UID);
  const auth = ctx?.state?.auth;
  return strapi.contentAPI.sanitize.output(user as any, schema as any, { auth });
};

const fetchAndSanitizeUserById = async (strapi: Core.Strapi, id: unknown, ctx: any) => {
  const user = await strapi.db.query(USER_UID).findOne({
    where: { id },
    populate: USER_SAFE_POPULATE,
  });
  if (!user) return null;
  return stripSensitiveUserFields(await sanitizeUserEntity(strapi, user, ctx));
};

const enforceUserSafePopulate = (ctx: any) => {
  const query = ctx.query ?? {};
  ctx.query = {
    ...query,
    populate: USER_SAFE_POPULATE,
  };
};

const postProcessUserResponse = async (strapi: Core.Strapi, ctx: any) => {
  const body = ctx.body;

  if (body == null || typeof body !== 'object') {
    ctx.body = stripSensitiveFromBody(body);
    return;
  }

  if (Array.isArray(body)) {
    ctx.body = stripSensitiveFromBody(body);
    return;
  }

  if (body.user?.id != null) {
    const populatedUser = await fetchAndSanitizeUserById(strapi, body.user.id, ctx);
    ctx.body = populatedUser ? { ...body, user: populatedUser } : stripSensitiveFromBody(body);
    return;
  }

  if (body.id != null) {
    const populatedUser = await fetchAndSanitizeUserById(strapi, body.id, ctx);
    ctx.body = populatedUser ?? stripSensitiveUserFields(body);
    return;
  }

  ctx.body = stripSensitiveFromBody(body);
};

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    const usersPermissions = strapi.plugin('users-permissions');
    if (!usersPermissions) return;

    const getRequiredEnv = (name: string) => {
      const value = process.env[name];
      if (!value) {
        const err: any = new Error(`Missing required env var: ${name}`);
        err.status = 500;
        throw err;
      }
      return value;
    };

    const getRestPrefix = () => {
      const prefix = strapi?.config?.get?.('api.rest.prefix');
      if (typeof prefix === 'string' && prefix.length > 0) return prefix;
      return '/api';
    };

    const getRefreshCookiePath = () => `${getRestPrefix()}/auth/refresh`;

    const setRefreshCookie = (ctx: any, token: string, expiresAt: Date | null) => {
      ctx.cookies.set(REFRESH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: getRefreshCookiePath(),
        ...(expiresAt ? { expires: expiresAt } : {}),
      });
    };

    const clearRefreshCookie = (ctx: any) => {
      ctx.cookies.set(REFRESH_COOKIE_NAME, '', {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: getRefreshCookiePath(),
        expires: new Date(0),
      });
    };

    const signAccessToken = ({ userId, role }: { userId: number; role: unknown }) => {
      const secret = getRequiredEnv('ACCESS_TOKEN_SECRET');
      const expiresIn = process.env.ACCESS_TOKEN_EXPIRES || '10m';
      return jwt.sign({ userId, role }, secret, { expiresIn });
    };

    const signRefreshToken = ({ userId }: { userId: number }) => {
      const secret = getRequiredEnv('REFRESH_TOKEN_SECRET');
      const expiresIn = process.env.REFRESH_TOKEN_EXPIRES || '7d';
      const jti = randomUUID();
      const token = jwt.sign({ userId, jti }, secret, { expiresIn });
      const decoded = jwt.decode(token);
      const expiresAt =
        decoded && typeof decoded === 'object' && typeof decoded.exp === 'number'
          ? new Date(decoded.exp * 1000)
          : null;
      return { token, jti, expiresAt };
    };

    const verifyRefreshToken = (token: string) => {
      const secret = getRequiredEnv('REFRESH_TOKEN_SECRET');
      return jwt.verify(token, secret);
    };

    const wrapUserQuery = (action: Function) => {
      return async (ctx: any) => {
        enforceUserSafePopulate(ctx);
        const result = await action(ctx);
        await postProcessUserResponse(strapi, ctx);
        return result;
      };
    };

    const wrapPostProcess = (action: Function) => {
      return async (...args: any[]) => {
        const ctx = args[0];
        const result = await action(...args);
        if (ctx) {
          await postProcessUserResponse(strapi, ctx);
        }
        return result;
      };
    };

    const controllers: any = usersPermissions.controllers;

    if (controllers?.auth?.callback && typeof controllers.auth.callback === 'function') {
      const originalCallback = controllers.auth.callback;
      controllers.auth.callback = async (ctx: any) => {
        const provider = String(ctx?.params?.provider ?? '');

        await originalCallback(ctx);

        if (provider !== 'local') return;

        const user = ctx?.body?.user;
        const userId = Number(user?.id);
        if (!Number.isFinite(userId) || userId <= 0) ctx.throw(500, 'Invalid authenticated user');

        const role = user?.role?.type ?? user?.role?.name ?? null;
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

        setRefreshCookie(ctx, refreshToken, expiresAt);

        if (ctx.body && typeof ctx.body === 'object') {
          ctx.body = { ...(ctx.body as any), jwt: accessToken };
        } else {
          ctx.body = { jwt: accessToken, user };
        }
      };
    }

    if (controllers?.auth?.local && typeof controllers.auth.local === 'function') {
      const originalLocal = controllers.auth.local;
      controllers.auth.local = async (ctx: any) => {
        await originalLocal(ctx);

        const user = ctx?.body?.user;
        const userId = Number(user?.id);
        if (!Number.isFinite(userId) || userId <= 0) return;

        const role = user?.role?.type ?? user?.role?.name ?? null;
        const accessToken = signAccessToken({ userId, role });
        const { token: refreshToken, expiresAt } = signRefreshToken({ userId });

        await strapi.entityService.create('api::refresh-token.refresh-token', {
          data: {
            user: userId,
            token: refreshToken,
            expiresAt: expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            revoked: false,
          },
        } as any);

        setRefreshCookie(ctx, refreshToken, expiresAt);

        if (ctx.body && typeof ctx.body === 'object') {
          ctx.body = { ...(ctx.body as any), jwt: accessToken };
        } else {
          ctx.body = { jwt: accessToken, user };
        }
      };
    }

    if (controllers?.auth?.login && typeof controllers.auth.login === 'function') {
      const originalLogin = controllers.auth.login;
      controllers.auth.login = async (ctx: any) => {
        await originalLogin(ctx);

        const user = ctx?.body?.user;
        const userId = Number(user?.id);
        if (!Number.isFinite(userId) || userId <= 0) return;

        const role = user?.role?.type ?? user?.role?.name ?? null;
        const accessToken = signAccessToken({ userId, role });
        const { token: refreshToken, expiresAt } = signRefreshToken({ userId });

        await strapi.entityService.create('api::refresh-token.refresh-token', {
          data: {
            user: userId,
            token: refreshToken,
            expiresAt: expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            revoked: false,
          },
        } as any);

        setRefreshCookie(ctx, refreshToken, expiresAt);

        if (ctx.body && typeof ctx.body === 'object') {
          ctx.body = { ...(ctx.body as any), jwt: accessToken };
        } else {
          ctx.body = { jwt: accessToken, user };
        }
      };
    }

    if (controllers?.auth && typeof controllers.auth === 'object') {
      if (typeof controllers.auth.refresh !== 'function') {
        controllers.auth.refresh = async (ctx: any) => {
          const token = ctx?.cookies?.get?.(REFRESH_COOKIE_NAME);
          if (!token) ctx.throw(401, 'Unauthorized');

          let payload: any;
          try {
            payload = verifyRefreshToken(token);
          } catch (e: any) {
            if (e && e.status === 500) ctx.throw(500, e.message);
            ctx.throw(401, 'Unauthorized');
          }

          const userId = Number(payload?.userId);
          if (!Number.isFinite(userId) || userId <= 0) ctx.throw(401, 'Unauthorized');

          const rows = await strapi.entityService.findMany('api::refresh-token.refresh-token', {
            filters: { token },
            limit: 1,
            sort: ['createdAt:desc', 'id:desc'],
            populate: { user: { fields: ['id'], populate: { role: { fields: ['id', 'name', 'type'] } } } },
          } as any);

          const record = Array.isArray(rows) ? (rows as any[])[0] : null;
          if (!record || record.revoked === true) ctx.throw(401, 'Unauthorized');

          const expiresAt = record.expiresAt ? new Date(record.expiresAt) : null;
          if (expiresAt && Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() <= Date.now()) {
            ctx.throw(401, 'Unauthorized');
          }

          await strapi.entityService.update('api::refresh-token.refresh-token', record.id, {
            data: { revoked: true },
          } as any);

          const role = record?.user?.role?.type ?? record?.user?.role?.name ?? null;
          const accessToken = signAccessToken({ userId, role });
          const next = signRefreshToken({ userId });

          await strapi.entityService.create('api::refresh-token.refresh-token', {
            data: {
              user: userId,
              token: next.token,
              expiresAt: next.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              revoked: false,
            },
          } as any);

          setRefreshCookie(ctx, next.token, next.expiresAt);

          ctx.body = { jwt: accessToken };
        };
      }

      if (typeof controllers.auth.logout !== 'function') {
        controllers.auth.logout = async (ctx: any) => {
          const token = ctx?.cookies?.get?.(REFRESH_COOKIE_NAME);

          if (token) {
            const rows = await strapi.entityService.findMany('api::refresh-token.refresh-token', {
              filters: { token },
              limit: 1,
              sort: ['createdAt:desc', 'id:desc'],
            } as any);
            const record = Array.isArray(rows) ? (rows as any[])[0] : null;
            if (record && record.revoked !== true) {
              await strapi.entityService.update('api::refresh-token.refresh-token', record.id, {
                data: { revoked: true },
              } as any);
            }
          }

          clearRefreshCookie(ctx);
          ctx.body = { ok: true };
        };
      }
    }

    if (usersPermissions.routes?.['content-api']?.routes && Array.isArray(usersPermissions.routes['content-api'].routes)) {
      const routes: any[] = usersPermissions.routes['content-api'].routes;
      const hasRoute = (method: string, path: string) =>
        routes.some(
          (r) => String(r?.method ?? '').toUpperCase() === method.toUpperCase() && String(r?.path ?? '') === path
        );

      if (!hasRoute('POST', '/auth/refresh')) {
        routes.push({
          method: 'POST',
          path: '/auth/refresh',
          handler: 'auth.refresh',
          config: { auth: false },
        });
      }

      if (!hasRoute('POST', '/auth/logout')) {
        routes.push({
          method: 'POST',
          path: '/auth/logout',
          handler: 'auth.logout',
          config: { auth: false },
        });
      }
    }

    if (controllers?.user?.me) controllers.user.me = wrapUserQuery(controllers.user.me);
    if (controllers?.user?.find) controllers.user.find = wrapUserQuery(controllers.user.find);
    if (controllers?.user?.findOne) controllers.user.findOne = wrapUserQuery(controllers.user.findOne);
    if (controllers?.user?.create) controllers.user.create = wrapPostProcess(controllers.user.create);
    if (controllers?.user?.update) controllers.user.update = wrapPostProcess(controllers.user.update);
    if (controllers?.user?.destroy) controllers.user.destroy = wrapPostProcess(controllers.user.destroy);

    if (controllers?.auth) {
      Object.keys(controllers.auth).forEach((key) => {
        if (typeof controllers.auth[key] === 'function') {
          controllers.auth[key] = wrapPostProcess(controllers.auth[key]);
        }
      });
    }
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const g = globalThis as any;
    if (!g.__strapiTempCleanupRejectionHandler) {
      g.__strapiTempCleanupRejectionHandler = true;
      process.on('unhandledRejection', (reason) => {
        const err = reason as any;
        const code = err?.code;
        const syscall = err?.syscall;
        const filePath = err?.path;
        if ((code === 'EBUSY' || code === 'EPERM') && syscall === 'unlink' && typeof filePath === 'string') {
          strapi.log.warn('Ignored temp file cleanup error', {
            code,
            syscall,
            path: filePath,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
    }

    const knex = strapi.db.connection;

    const hasQuestionsTable = await knex.schema.hasTable('questions');
    if (!hasQuestionsTable) return;

    const hasType = await knex.schema.hasColumn('questions', 'type');
    if (hasType) {
      await knex.raw('CREATE INDEX IF NOT EXISTS questions_type_idx ON questions (type)');
    }

    const hasDifficulty = await knex.schema.hasColumn('questions', 'difficulty');
    if (hasDifficulty) {
      await knex.raw('CREATE INDEX IF NOT EXISTS questions_difficulty_idx ON questions (difficulty)');
    }

    if (hasType && hasDifficulty) {
      await knex.raw('CREATE INDEX IF NOT EXISTS questions_type_difficulty_idx ON questions (type, difficulty)');
    }

    const hasStatus = await knex.schema.hasColumn('questions', 'status');
    if (hasStatus) {
      await knex.raw('CREATE INDEX IF NOT EXISTS questions_status_idx ON questions (status)');
      if (hasDifficulty) {
        await knex.raw('CREATE INDEX IF NOT EXISTS questions_status_difficulty_idx ON questions (status, difficulty)');
      }
    }

    const joinTables = [
      {
        table: 'questions_levels_lnk',
        left: 'level_id',
        right: 'question_id',
      },
      {
        table: 'questions_skills_lnk',
        left: 'skill_id',
        right: 'question_id',
      },
      {
        table: 'questions_topics_lnk',
        left: 'topic_id',
        right: 'question_id',
      },
    ];

    for (const jt of joinTables) {
      const hasTable = await knex.schema.hasTable(jt.table);
      if (!hasTable) continue;
      const hasLeft = await knex.schema.hasColumn(jt.table, jt.left);
      const hasRight = await knex.schema.hasColumn(jt.table, jt.right);
      if (hasLeft) {
        await knex.raw(`CREATE INDEX IF NOT EXISTS ${jt.table}_${jt.left}_idx ON ${jt.table} (${jt.left})`);
      }
      if (hasRight) {
        await knex.raw(`CREATE INDEX IF NOT EXISTS ${jt.table}_${jt.right}_idx ON ${jt.table} (${jt.right})`);
      }
      if (hasLeft && hasRight) {
        await knex.raw(
          `CREATE INDEX IF NOT EXISTS ${jt.table}_${jt.left}_${jt.right}_idx ON ${jt.table} (${jt.left}, ${jt.right})`
        );
      }
    }

    const hasLessonAttempts = await knex.schema.hasTable('lesson_attempts');
    if (hasLessonAttempts) {
      const hasAttemptUser = await knex.schema.hasColumn('lesson_attempts', 'user_id');
      const hasAttemptLesson = await knex.schema.hasColumn('lesson_attempts', 'lesson_id');
      const hasAttemptStatus = await knex.schema.hasColumn('lesson_attempts', 'status');
      if (hasAttemptUser) {
        await knex.raw('CREATE INDEX IF NOT EXISTS lesson_attempts_user_idx ON lesson_attempts (user_id)');
      }
      if (hasAttemptLesson) {
        await knex.raw('CREATE INDEX IF NOT EXISTS lesson_attempts_lesson_idx ON lesson_attempts (lesson_id)');
      }
      if (hasAttemptStatus) {
        await knex.raw('CREATE INDEX IF NOT EXISTS lesson_attempts_status_idx ON lesson_attempts (status)');
      }
      if (hasAttemptUser && hasAttemptStatus) {
        await knex.raw(
          'CREATE INDEX IF NOT EXISTS lesson_attempts_user_status_idx ON lesson_attempts (user_id, status)'
        );
      }
    }

    const hasUserAnswers = await knex.schema.hasTable('user_answers');
    if (hasUserAnswers) {
      const hasAnswerAttempt = await knex.schema.hasColumn('user_answers', 'lesson_attempt_id');
      const hasAnswerQuestion = await knex.schema.hasColumn('user_answers', 'question_id');
      const hasAnswerCorrect = await knex.schema.hasColumn('user_answers', 'is_correct');
      if (hasAnswerAttempt) {
        await knex.raw(
          'CREATE INDEX IF NOT EXISTS user_answers_lesson_attempt_idx ON user_answers (lesson_attempt_id)'
        );
      }
      if (hasAnswerQuestion) {
        await knex.raw('CREATE INDEX IF NOT EXISTS user_answers_question_idx ON user_answers (question_id)');
      }
      if (hasAnswerCorrect) {
        await knex.raw('CREATE INDEX IF NOT EXISTS user_answers_is_correct_idx ON user_answers (is_correct)');
      }
      if (hasAnswerQuestion && hasAnswerCorrect) {
        await knex.raw(
          'CREATE INDEX IF NOT EXISTS user_answers_question_correct_idx ON user_answers (question_id, is_correct)'
        );
      }
    }
  },
};
