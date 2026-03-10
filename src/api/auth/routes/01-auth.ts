import type { Core } from '@strapi/strapi';

const config: Core.RouterConfig = {
  type: 'content-api',
  routes: [
    {
      method: 'POST',
      path: '/auth/register',
      handler: 'api::auth.auth.register',
      config: {
        policies: [],
        description: 'Register a new user and send verification email',
        tag: { plugin: 'auth', name: 'Auth' },
      } as any,
    },
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
    {
      method: 'GET',
      path: '/auth/verify-email',
      handler: 'api::auth.auth.verifyEmail',
      config: {
        policies: [],
        description: 'Verify email using token and redirect to frontend',
        tag: { plugin: 'auth', name: 'Auth' },
      } as any,
    },
  ],
};

export default config;
