import type { Core } from '@strapi/strapi';

const USER_UID = 'plugin::users-permissions.user';
const USER_SAFE_POPULATE = {
  avatar: true,
  role: { fields: ['id', 'name', 'type'] },
};

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
