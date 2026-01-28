import type { Core } from '@strapi/strapi';

type QuestionType = 'multiple_choice' | 'fill_blank' | 'true_false' | 'short_answer';

type EntityId = string | number;

export type SelectedQuestion = {
  id: EntityId;
  content: string;
  type: QuestionType;
  options: unknown;
  difficulty: number | null;
};

type QuestionBankFiltersInput = Record<string, unknown> | null | undefined;

type QuestionSelectionOptions = {
  count: number;
  shuffle: boolean;
  filters: QuestionBankFiltersInput;
  oversample?: number;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter((v) => v.length > 0);
};

const shuffleInPlace = <T>(items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
};

const buildQuestionFilters = (filters: QuestionBankFiltersInput): Record<string, unknown> => {
  const input = (filters ?? {}) as Record<string, unknown>;

  const levelCodes = toStringArray(input.levels ?? input.levelCodes);
  const skillCodes = toStringArray(input.skills ?? input.skillCodes);
  const topicCodes = toStringArray(input.topics ?? input.topicCodes);

  const questionFilters: Record<string, unknown> = {};

  if (levelCodes.length > 0) {
    questionFilters.levels = { code: { $in: levelCodes } };
  }
  if (skillCodes.length > 0) {
    questionFilters.skills = { code: { $in: skillCodes } };
  }
  if (topicCodes.length > 0) {
    questionFilters.topics = { code: { $in: topicCodes } };
  }

  return questionFilters;
};

const sanitizeQuestions = (rows: any[]): SelectedQuestion[] => {
  return rows.map((q) => ({
    id: q.id,
    content: q.content,
    type: q.type,
    options: q.options ?? null,
    difficulty: typeof q.difficulty === 'number' ? q.difficulty : null,
  }));
};

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  buildQuestionFilters,

  async selectQuestions(options: QuestionSelectionOptions): Promise<SelectedQuestion[]> {
    const count = Math.max(0, Math.trunc(options.count));
    if (count === 0) return [];

    const questionFilters = buildQuestionFilters(options.filters);
    const fields = ['content', 'type', 'options', 'difficulty'] as const;
    const oversample = options.oversample ?? Math.min(Math.max(count * 4, count), 800);

    if (!options.shuffle) {
      const rows = (await strapi.entityService.findMany('api::question.question', {
        filters: questionFilters,
        fields: [...fields],
        sort: ['id:asc'],
        limit: count,
      })) as any[];

      return sanitizeQuestions(rows);
    }

    const maxRows = (await strapi.entityService.findMany('api::question.question', {
      filters: questionFilters,
      fields: ['id'],
      sort: ['id:desc'],
      limit: 1,
    })) as Array<{ id: EntityId }>;

    const maxId = Number(maxRows[0]?.id);
    if (!Number.isFinite(maxId) || maxId <= 0) return [];

    const randomStart = 1 + Math.floor(Math.random() * maxId);

    const firstBatch = (await strapi.entityService.findMany('api::question.question', {
      filters: { ...questionFilters, id: { $gte: randomStart } },
      fields: [...fields],
      sort: ['id:asc'],
      limit: oversample,
    })) as any[];

    let candidates = firstBatch;

    if (candidates.length < oversample) {
      const secondBatch = (await strapi.entityService.findMany('api::question.question', {
        filters: { ...questionFilters, id: { $lt: randomStart } },
        fields: [...fields],
        sort: ['id:asc'],
        limit: oversample - candidates.length,
      })) as any[];

      candidates = candidates.concat(secondBatch);
    }

    shuffleInPlace(candidates);
    return sanitizeQuestions(candidates.slice(0, count));
  },
});
