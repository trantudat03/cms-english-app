import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/lessons/:id/submit',
      handler: 'api::lesson.lesson.submit',
      config: {
        policies: ['api::lesson.require-user'],
      },
    },
  ],
};

export default config;
