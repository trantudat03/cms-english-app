'use strict';

async function up(knex) {
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
}

module.exports = { up };
