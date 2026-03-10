export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  url: env('STRAPI_URL'),
  app: {
    keys: env.array('APP_KEYS'),
  },
  cron: {
    enabled: true,
    tasks: {
      revokeExpiredRefreshTokens: {
        task: async ({ strapi }) => {
          const nowIso = new Date().toISOString();
          await (strapi as any).db.query('api::refresh-token.refresh-token').updateMany({
            where: { isRevoked: false, expiresAt: { $lt: nowIso } },
            data: { isRevoked: true },
          });
        },
        options: {
          rule: '0 3 * * *',
        },
      },
    },
  },
});
