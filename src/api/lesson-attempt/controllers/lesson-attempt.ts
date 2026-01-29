/**
 * lesson-attempt controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::lesson-attempt.lesson-attempt' as any, ({ strapi }) => ({
  async result(ctx) {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      ctx.throw(400, 'Invalid attempt id');
    }

    const user = ctx.state.user as { id: number } | undefined;
    if (!user?.id) {
      ctx.throw(401, 'Unauthorized');
    }

    const includeExplanation = String((ctx.query as any)?.includeExplanation ?? 'false') === 'true';

    const attempt = await strapi.entityService.findOne('api::lesson-attempt.lesson-attempt' as any, id, {
      fields: ['status', 'startedAt', 'submittedAt', 'score', 'correctCount', 'totalQuestions', 'timeSpent'],
      populate: {
        user: { fields: ['id'] },
        lesson: { fields: ['title', 'description', 'lessonType', 'passScore', 'timeLimit'] },
        questionBank: { fields: ['name'] },
        answers: {
          fields: ['response', 'isCorrect', 'timeSpent', 'earnedScore', 'createdAt'],
          populate: {
            question: {
              fields: includeExplanation ? ['content', 'type', 'options', 'explanation'] : ['content', 'type', 'options'],
            },
          },
        },
      },
    } as any);

    if (!attempt) {
      ctx.throw(404, 'Attempt not found');
    }

    const attemptEntity = attempt as any;
    const attemptUserId = Number(attemptEntity.user?.id);
    if (!Number.isFinite(attemptUserId) || attemptUserId !== user.id) {
      ctx.throw(403, 'Forbidden');
    }

    return {
      attempt: {
        id: attemptEntity.id,
        status: attemptEntity.status,
        startedAt: attemptEntity.startedAt,
        submittedAt: attemptEntity.submittedAt ?? null,
        score: attemptEntity.score ?? null,
        correctCount: attemptEntity.correctCount ?? null,
        totalQuestions: attemptEntity.totalQuestions ?? null,
        timeSpent: attemptEntity.timeSpent ?? null,
      },
      lesson: attemptEntity.lesson ?? null,
      questionBank: attemptEntity.questionBank ?? null,
      answers: attemptEntity.answers ?? [],
    };
  },
}));
