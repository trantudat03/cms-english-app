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

  async meHistory(ctx) {
    const user = ctx.state.user as { id: number } | undefined;
    if (!user?.id) {
      ctx.throw(401, 'Unauthorized');
    }

    const query = (ctx.query ?? {}) as any;
    const pageRaw = Number(query.page ?? 1);
    const pageSizeRaw = Number(query.pageSize ?? 20);

    const page = Number.isFinite(pageRaw) ? Math.max(1, Math.trunc(pageRaw)) : 1;
    const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(100, Math.max(1, Math.trunc(pageSizeRaw))) : 20;

    const q = typeof query.q === 'string' ? query.q.trim() : '';

    const minScoreRaw = query.minScore;
    const minScoreNumber = Number(minScoreRaw);
    const minScore = Number.isFinite(minScoreNumber) ? Math.trunc(minScoreNumber) : null;

    const lessonTypeRaw = query.lessonType;
    const lessonType =
      lessonTypeRaw === 'lesson' || lessonTypeRaw === 'quiz' || lessonTypeRaw === 'test'
        ? (lessonTypeRaw as 'lesson' | 'quiz' | 'test')
        : lessonTypeRaw == null
          ? null
          : 'invalid';

    if (lessonType === 'invalid') {
      ctx.throw(400, 'Invalid lessonType');
    }

    const where: Record<string, any> = {
      user: user.id,
      status: 'completed',
    };

    if (minScore !== null) {
      where.score = { $gt: minScore };
    }

    const lessonWhere: Record<string, any> = {};
    if (q) {
      lessonWhere.title = { $containsi: q };
    }
    if (lessonType) {
      lessonWhere.lessonType = lessonType;
    }
    if (Object.keys(lessonWhere).length > 0) {
      where.lesson = lessonWhere;
    }

    const offset = (page - 1) * pageSize;

    const total = await strapi.db.query('api::lesson-attempt.lesson-attempt').count({ where });
    const pageCount = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

    const rows = (await strapi.db.query('api::lesson-attempt.lesson-attempt').findMany({
      where,
      select: ['id', 'status', 'startedAt', 'submittedAt', 'score', 'correctCount', 'totalQuestions', 'timeSpent'],
      populate: {
        lesson: { select: ['id', 'title', 'description', 'lessonType', 'passScore', 'timeLimit'] },
        questionBank: { select: ['id', 'name'] },
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      offset,
      limit: pageSize,
    })) as any[];

    return {
      data: rows.map((r) => ({
        attemptId: r.id,
        status: r.status,
        startedAt: r.startedAt,
        submittedAt: r.submittedAt ?? null,
        score: r.score ?? null,
        correctCount: r.correctCount ?? null,
        totalQuestions: r.totalQuestions ?? null,
        timeSpent: r.timeSpent ?? null,
        lesson: r.lesson ?? null,
        questionBank: r.questionBank ?? null,
      })),
      meta: {
        pagination: {
          page,
          pageSize,
          pageCount,
          total,
        },
      },
    };
  },
}));
