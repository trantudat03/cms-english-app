import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/auth/login',
      handler: 'api::auth.auth.login',
      config: {
        policies: [],
        description: 'Login with identifier and password',
        tag: { plugin: 'auth', name: 'Auth' },
      } as any,
    },
    {
      method: 'POST',
      path: '/auth/refresh',
      handler: 'api::auth.auth.refresh',
      config: {
        policies: [],
        description: 'Refresh access token',
        tag: { plugin: 'auth', name: 'Auth' },
      } as any,
    },
    {
      method: 'POST',
      path: '/auth/logout',
      handler: 'api::auth.auth.logout',
      config: {
        policies: [],
        description: 'Logout (revoke refresh token)',
        tag: { plugin: 'auth', name: 'Auth' },
      } as any,
    },
  ],
};

export default config;
