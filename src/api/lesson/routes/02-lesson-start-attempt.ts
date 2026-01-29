import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/lessons/:id/start',
      handler: 'api::lesson.lesson.startAttempt',
      config: {
        policies: ['api::lesson.require-user'],
      },
    },
  ],
};

export default config;
