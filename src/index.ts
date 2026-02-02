import type { Core } from '@strapi/strapi';
import { registerUsersPermissionsPasswordResetHardening } from './utils/users-permissions/password-reset';
import { extendUsersPermissionsUserSchema } from './utils/users-permissions/user-schema';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    extendUsersPermissionsUserSchema(strapi);
    registerUsersPermissionsPasswordResetHardening(strapi);
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
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
