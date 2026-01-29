import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/question-banks/:id/preview',
      handler: 'api::question-bank.question-bank.preview',
    },
  ],
};

export default config;

