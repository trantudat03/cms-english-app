'use strict';

const USER_UID = 'plugin::users-permissions.user';
const USER_SAFE_POPULATE = {
  avatar: true,
  role: { fields: ['id', 'name', 'type'] },
};

const stripSensitiveUserFields = (user) => {
  if (user == null || typeof user !== 'object' || Array.isArray(user)) return user;

  const sanitized = { ...user };
  delete sanitized.password;
  delete sanitized.resetPasswordToken;
  delete sanitized.confirmationToken;
  return sanitized;
};

const stripSensitiveFromBody = (body) => {
  if (Array.isArray(body)) return body.map(stripSensitiveUserFields);
  if (body == null || typeof body !== 'object') return body;

  if ('user' in body) {
    return { ...body, user: stripSensitiveUserFields(body.user) };
  }

  return stripSensitiveUserFields(body);
};

const sanitizeUserEntity = async (user, ctx) => {
  const schema = strapi.getModel(USER_UID);
  const { auth } = ctx.state;
  return strapi.contentAPI.sanitize.output(user, schema, { auth });
};

const fetchAndSanitizeUserById = async (id, ctx) => {
  const user = await strapi.db.query(USER_UID).findOne({
    where: { id },
    populate: USER_SAFE_POPULATE,
  });
  if (!user) return null;
  return stripSensitiveUserFields(await sanitizeUserEntity(user, ctx));
};

const enforceUserSafePopulate = (ctx) => {
  const query = ctx.query ?? {};
  ctx.query = {
    ...query,
    populate: USER_SAFE_POPULATE,
  };
};

const postProcessUserResponse = async (ctx) => {
  const body = ctx.body;

  if (body == null || typeof body !== 'object') {
    ctx.body = stripSensitiveFromBody(body);
    return;
  }

  if (Array.isArray(body)) {
    ctx.body = stripSensitiveFromBody(body);
    return;
  }

  if (body.user?.id != null) {
    const populatedUser = await fetchAndSanitizeUserById(body.user.id, ctx);
    ctx.body = populatedUser ? { ...body, user: populatedUser } : stripSensitiveFromBody(body);
    return;
  }

  if (body.id != null) {
    const populatedUser = await fetchAndSanitizeUserById(body.id, ctx);
    ctx.body = populatedUser ?? stripSensitiveUserFields(body);
    return;
  }

  ctx.body = stripSensitiveFromBody(body);
};

module.exports = (plugin) => {
  const wrapUserQuery = (action) => {
    return async (ctx) => {
      enforceUserSafePopulate(ctx);
      const result = await action(ctx);
      await postProcessUserResponse(ctx);
      return result;
    };
  };

  const wrapPostProcess = (action) => {
    return async (...args) => {
      const ctx = args[0];
      const result = await action(...args);
      if (ctx) {
        await postProcessUserResponse(ctx);
      }
      return result;
    };
  };

  if (plugin.controllers?.user?.me) {
    plugin.controllers.user.me = wrapUserQuery(plugin.controllers.user.me);
  }
  if (plugin.controllers?.user?.find) {
    plugin.controllers.user.find = wrapUserQuery(plugin.controllers.user.find);
  }
  if (plugin.controllers?.user?.findOne) {
    plugin.controllers.user.findOne = wrapUserQuery(plugin.controllers.user.findOne);
  }
  if (plugin.controllers?.user?.create) {
    plugin.controllers.user.create = wrapPostProcess(plugin.controllers.user.create);
  }
  if (plugin.controllers?.user?.update) {
    plugin.controllers.user.update = wrapPostProcess(plugin.controllers.user.update);
  }
  if (plugin.controllers?.user?.destroy) {
    plugin.controllers.user.destroy = wrapPostProcess(plugin.controllers.user.destroy);
  }

  if (plugin.controllers?.auth) {
    Object.keys(plugin.controllers.auth).forEach((key) => {
      if (typeof plugin.controllers.auth[key] === 'function') {
        plugin.controllers.auth[key] = wrapPostProcess(plugin.controllers.auth[key]);
      }
    });
  }

  return plugin;
};
