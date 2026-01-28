/**
 * lesson controller
 */

import { factories } from '@strapi/strapi';
import type { SelectedQuestion } from '../services/question-selection';

type EntityId = string | number;

type StartLessonResponse = {
  lesson: { id: EntityId; title: string; description: string | null };
  questionBank: { id: EntityId; name: string };
  count: number;
  questions: SelectedQuestion[];
};

export default factories.createCoreController('api::lesson.lesson', ({ strapi }) => ({
  async start(ctx): Promise<StartLessonResponse> {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      ctx.throw(400, 'Invalid lesson id');
    }

    const lesson = await strapi.entityService.findOne('api::lesson.lesson', id, {
      fields: ['title', 'description', 'questionCount'],
      populate: {
        questionBank: {
          fields: ['name', 'filters', 'defaultQuestionCount', 'shuffle', 'active'],
        },
      },
    });

    if (!lesson) {
      ctx.throw(404, 'Lesson not found');
    }

    const lessonEntity = lesson as any;

    const questionBank = lessonEntity.questionBank as
      | {
          id: EntityId;
          name: string;
          filters?: unknown;
          defaultQuestionCount?: number;
          shuffle?: boolean;
          active?: boolean;
        }
      | null
      | undefined;

    if (!questionBank) {
      ctx.throw(400, 'Lesson is missing a question bank');
    }

    if (questionBank.active === false) {
      ctx.throw(400, 'Question bank is inactive');
    }

    const rawCount =
      typeof lessonEntity.questionCount === 'number' && lessonEntity.questionCount > 0
        ? lessonEntity.questionCount
        : typeof questionBank.defaultQuestionCount === 'number' && questionBank.defaultQuestionCount > 0
          ? questionBank.defaultQuestionCount
          : 10;

    const maxCount = 200;
    const count = Math.min(rawCount, maxCount);
    const selector = strapi.service('api::lesson.question-selection') as {
      selectQuestions: (opts: {
        count: number;
        shuffle: boolean;
        filters: unknown;
        oversample?: number;
      }) => Promise<SelectedQuestion[]>;
    };

    const questions = await selector.selectQuestions({
      count,
      shuffle: Boolean(questionBank.shuffle),
      filters: questionBank.filters,
      oversample: Math.min(Math.max(count * 4, count), 800),
    });

    return {
      lesson: {
        id: lessonEntity.id,
        title: lessonEntity.title,
        description: lessonEntity.description ?? null,
      },
      questionBank: { id: questionBank.id, name: questionBank.name },
      count: questions.length,
      questions,
    };
  },
}));
