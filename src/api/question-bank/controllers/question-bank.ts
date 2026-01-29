/**
 * question-bank controller
 */

import { factories } from '@strapi/strapi';

const previewCountCache = new Map<string, { value: number; expiresAt: number }>();

const getCachedCount = async (key: string, ttlMs: number, compute: () => Promise<number>): Promise<number> => {
  const now = Date.now();
  const cached = previewCountCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await compute();
  previewCountCache.set(key, { value, expiresAt: now + ttlMs });
  return value;
};

export default factories.createCoreController('api::question-bank.question-bank', ({ strapi }) => ({
  async preview(ctx) {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      ctx.throw(400, 'Invalid question bank id');
    }

    const sampleCountRaw = Number((ctx.query as any)?.sample ?? (ctx.query as any)?.count ?? 5);
    const sampleCount = Number.isFinite(sampleCountRaw) ? Math.min(Math.max(1, Math.trunc(sampleCountRaw)), 20) : 5;

    const questionBank = await strapi.entityService.findOne('api::question-bank.question-bank', id, {
      fields: ['name', 'description', 'filters', 'active', 'defaultQuestionCount', 'shuffle', 'randomizationStrategy'],
    } as any);

    if (!questionBank) {
      ctx.throw(404, 'Question bank not found');
    }

    const qb = questionBank as any;
    if (qb.active === false) {
      ctx.throw(400, 'Question bank is inactive');
    }

    const selector = strapi.service('api::lesson.question-selection') as {
      buildQuestionFilters: (filters: unknown) => Record<string, unknown>;
      selectQuestions: (opts: {
        count: number;
        shuffle: boolean;
        filters: unknown;
        oversample?: number;
      }) => Promise<any[]>;
    };

    const where = selector.buildQuestionFilters(qb.filters);
    (where as any).status = 'published';

    const cacheKey = `qb:${qb.id}:` + JSON.stringify(where);
    const estimatedCount = await getCachedCount(cacheKey, 30_000, async () => {
      const result = await strapi.db.query('api::question.question').count({ where });
      return typeof result === 'number' ? result : Number(result);
    });
    const sampleQuestions = await selector.selectQuestions({
      count: sampleCount,
      shuffle: true,
      filters: qb.filters,
      oversample: Math.min(Math.max(sampleCount * 4, sampleCount), 200),
    });

    return {
      questionBank: { id: qb.id, name: qb.name, description: qb.description ?? null },
      estimatedCount,
      sampleCount: sampleQuestions.length,
      sampleQuestions,
    };
  },
}));
