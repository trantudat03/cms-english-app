'use strict';

async function up(knex) {
  const hasUsersTable = await knex.schema.hasTable('up_users');
  if (!hasUsersTable) return;

  const hasExpiryColumn = await knex.schema.hasColumn('up_users', 'reset_password_token_expires_at');
  if (!hasExpiryColumn) {
    await knex.schema.alterTable('up_users', (table) => {
      table.timestamp('reset_password_token_expires_at');
    });
  }

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS up_users_reset_password_token_expires_at_idx ON up_users (reset_password_token_expires_at)'
  );
}

module.exports = { up };

