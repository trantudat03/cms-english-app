import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/lesson-attempts/:id/result',
      handler: 'api::lesson-attempt.lesson-attempt.result',
      config: {
        policies: ['api::lesson-attempt.is-owner'],
      },
    },
  ],
};

export default config;
