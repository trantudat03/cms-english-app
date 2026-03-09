import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/auth/login',
      handler: 'api::auth.auth.login',
    },
    {
      method: 'POST',
      path: '/auth/refresh',
      handler: 'api::auth.auth.refresh',
    },
    {
      method: 'POST',
      path: '/auth/logout',
      handler: 'api::auth.auth.logout',
    },
  ],
};

export default config;
