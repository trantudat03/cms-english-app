import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/me/lesson-history',
      handler: 'api::lesson-attempt.lesson-attempt.meHistory',
      config: {
        policies: ['api::lesson.require-user'],
      },
    },
  ],
};

export default config;
