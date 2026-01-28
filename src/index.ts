import type { Core } from '@strapi/strapi';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

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
  },
};
