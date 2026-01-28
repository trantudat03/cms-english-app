import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/lessons/:id/start',
      handler: 'api::lesson.lesson.start',
    },
  ],
};

export default config;
