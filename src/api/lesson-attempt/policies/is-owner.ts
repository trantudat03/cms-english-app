export default async (ctx: any, _config: any, { strapi }: any) => {
  const userId = Number(ctx.state.user?.id);
  if (!Number.isFinite(userId) || userId <= 0) return false;

  const attemptId = Number(ctx.params.id);
  if (!Number.isFinite(attemptId)) return false;

  const attempt = await strapi.entityService.findOne('api::lesson-attempt.lesson-attempt', attemptId, {
    fields: ['id'],
    populate: { user: { fields: ['id'] } },
  });

  const attemptUserId = Number((attempt as any)?.user?.id);
  return Number.isFinite(attemptUserId) && attemptUserId === userId;
};
