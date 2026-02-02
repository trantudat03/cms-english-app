export default ({ env }) => ({
  email: {
    config: {
      provider: 'strapi-provider-email-resend',
      providerOptions: {
        apiKey: env('RESEND_API_KEY'),
      },
      settings: {
        defaultFrom: env('RESEND_DEFAULT_FROM'),
        defaultReplyTo: env('RESEND_DEFAULT_REPLY_TO', env('RESEND_DEFAULT_FROM')),
      },
    },
  },

  'users-permissions': {
    config: {
      ratelimit: {
        interval: 60 * 1000,
        max: env.int('UP_AUTH_RATELIMIT_MAX', 5),
      },
    },
  },
});
