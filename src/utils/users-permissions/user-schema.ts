import type { Core } from '@strapi/strapi';

export const extendUsersPermissionsUserSchema = (strapi: Core.Strapi) => {
  const userContentType = strapi.contentType('plugin::users-permissions.user');
  if (!userContentType) return;

  const attributes = (userContentType as any).attributes ?? {};
  if (attributes.resetPasswordTokenExpiresAt) return;

  (userContentType as any).attributes = {
    ...attributes,
    resetPasswordTokenExpiresAt: {
      type: 'datetime',
      private: true,
      configurable: false,
    },
  };
};

