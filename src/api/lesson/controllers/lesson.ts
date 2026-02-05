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

type StartLessonAttemptResponse = StartLessonResponse & {
  attempt: {
    id: EntityId;
    status: 'in_progress';
    startedAt: string;
  };
};

const mergePopulate = (existing: unknown, extra: Record<string, any>): any => {
  if (existing == null) return extra;
  if (existing === '*' || existing === true) return existing;
  if (typeof existing === 'string') {
    if (existing.includes('*')) return '*';
    return extra;
  }
  if (Array.isArray(existing)) return '*';
  if (typeof existing === 'object') return { ...(existing as any), ...extra };
  return extra;
};

export default factories.createCoreController('api::lesson.lesson', ({ strapi }) => ({
  async find(ctx) {
    const query = (ctx.query ?? {}) as any;
    ctx.query = {
      ...query,
      populate: mergePopulate(query.populate, { background: true, mascot: true }),
    };
    return await super.find(ctx);
  },

  async findOne(ctx) {
    const query = (ctx.query ?? {}) as any;
    ctx.query = {
      ...query,
      populate: mergePopulate(query.populate, { background: true, mascot: true }),
    };
    return await super.findOne(ctx);
  },

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
    } as any);

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

  async startAttempt(ctx): Promise<StartLessonAttemptResponse> {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      ctx.throw(400, 'Invalid lesson id');
    }

    const user = ctx.state.user as { id: number } | undefined;
    if (!user?.id) {
      ctx.throw(401, 'Unauthorized');
    }

    const lesson = await strapi.entityService.findOne('api::lesson.lesson', id, {
      fields: [
        'title',
        'description',
        'questionCount',
        'timeLimit',
        'passScore',
        'retryPolicy',
        'shuffleQuestions',
        'showExplanationOnSubmit',
        'lessonType',
      ],
      populate: {
        questionBank: {
          fields: [
            'name',
            'filters',
            'defaultQuestionCount',
            'shuffle',
            'active',
            'randomizationStrategy',
          ],
        },
      },
    } as any);

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
          randomizationStrategy?: 'random' | 'weighted' | 'fixed_order';
        }
      | null
      | undefined;

    const existingAttempts = (await strapi.entityService.findMany('api::lesson-attempt.lesson-attempt' as any, {
      filters: { user: user.id, lesson: id, status: 'in_progress' },
      sort: ['startedAt:desc', 'id:desc'],
      limit: 1,
      fields: ['id', 'status', 'startedAt', 'generatedQuestionIds'],
      populate: { questionBank: { fields: ['name'] } },
    } as any)) as any[];

    const existingAttempt = Array.isArray(existingAttempts) ? existingAttempts[0] : null;
    if (existingAttempt) {
      const generatedQuestionIds = Array.isArray(existingAttempt.generatedQuestionIds)
        ? existingAttempt.generatedQuestionIds.map((v: unknown) => Number(v)).filter((v: number) => Number.isFinite(v))
        : [];

      if (generatedQuestionIds.length === 0) {
        ctx.throw(400, 'Attempt has no generated questions');
      }

      const rows = (await strapi.entityService.findMany('api::question.question', {
        filters: { id: { $in: generatedQuestionIds } },
        fields: ['content', 'type', 'options', 'difficulty'],
        limit: generatedQuestionIds.length,
      } as any)) as any[];

      const questionMap = new Map<number, SelectedQuestion>();
      for (const q of rows) {
        const qid = Number(q.id);
        if (!Number.isFinite(qid)) continue;
        questionMap.set(qid, {
          id: q.id,
          content: q.content,
          type: q.type,
          options: q.options ?? null,
          difficulty: typeof q.difficulty === 'number' ? q.difficulty : null,
        });
      }

      const orderedQuestions = generatedQuestionIds.map((qid) => questionMap.get(qid)).filter(Boolean) as SelectedQuestion[];

      const responseQuestionBank =
        questionBank ??
        (existingAttempt.questionBank
          ? ({ id: existingAttempt.questionBank.id, name: existingAttempt.questionBank.name } as any)
          : null);

      if (!responseQuestionBank) {
        ctx.throw(400, 'Lesson is missing a question bank');
      }

      return {
        attempt: {
          id: existingAttempt.id,
          status: 'in_progress',
          startedAt: existingAttempt.startedAt,
        },
        lesson: {
          id: lessonEntity.id,
          title: lessonEntity.title,
          description: lessonEntity.description ?? null,
        },
        questionBank: { id: responseQuestionBank.id, name: responseQuestionBank.name },
        count: orderedQuestions.length,
        questions: orderedQuestions,
      };
    }

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
    const shuffle =
      typeof lessonEntity.shuffleQuestions === 'boolean'
        ? lessonEntity.shuffleQuestions
        : Boolean(questionBank.shuffle);

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
      shuffle,
      filters: questionBank.filters,
      oversample: Math.min(Math.max(count * 4, count), 800),
    });

    const generatedQuestionIds = questions.map((q) => Number(q.id)).filter((v) => Number.isFinite(v));
    const startedAt = new Date().toISOString();

    const attempt = await strapi.entityService.create('api::lesson-attempt.lesson-attempt' as any, {
      data: {
        user: user.id,
        lesson: id,
        questionBank: questionBank.id,
        generatedQuestionIds,
        status: 'in_progress',
        startedAt,
        totalQuestions: generatedQuestionIds.length,
        configSnapshot: {
          lessonType: lessonEntity.lessonType ?? null,
          timeLimit: typeof lessonEntity.timeLimit === 'number' ? lessonEntity.timeLimit : null,
          passScore: typeof lessonEntity.passScore === 'number' ? lessonEntity.passScore : null,
          retryPolicy: lessonEntity.retryPolicy ?? {},
          showExplanationOnSubmit: Boolean(lessonEntity.showExplanationOnSubmit),
          randomizationStrategy: questionBank.randomizationStrategy ?? 'random',
          filters: questionBank.filters ?? {},
        },
      },
      fields: ['id', 'status', 'startedAt'],
    } as any);

    const attemptEntity = attempt as any;

    return {
      attempt: {
        id: attemptEntity.id,
        status: 'in_progress',
        startedAt: attemptEntity.startedAt,
      },
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

  async submit(ctx) {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id)) {
      ctx.throw(400, 'Invalid lesson id');
    }

    const user = ctx.state.user as { id: number } | undefined;
    if (!user?.id) {
      ctx.throw(401, 'Unauthorized');
    }

    const body = (ctx.request.body ?? {}) as {
      attemptId?: unknown;
      answers?: unknown;
      timeSpent?: unknown;
      includeDetails?: unknown;
      includeExplanation?: unknown;
    };

    const attemptId = Number(body.attemptId);
    if (!Number.isFinite(attemptId)) {
      ctx.throw(400, 'Invalid attemptId');
    }

    if (!Array.isArray(body.answers)) {
      ctx.throw(400, 'Invalid answers');
    }

    const rawAnswers = body.answers as Array<{
      questionId?: unknown;
      response?: unknown;
      timeSpent?: unknown;
    }>;

    const attempt = await strapi.entityService.findOne('api::lesson-attempt.lesson-attempt' as any, attemptId, {
      fields: ['generatedQuestionIds', 'status', 'startedAt', 'submittedAt', 'totalQuestions'],
      populate: {
        user: { fields: ['id'] },
        lesson: { fields: ['passScore', 'showExplanationOnSubmit', 'timeLimit'] },
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

    const attemptLessonId = Number(attemptEntity.lesson?.id);
    if (!Number.isFinite(attemptLessonId) || attemptLessonId !== id) {
      ctx.throw(400, 'Attempt does not belong to this lesson');
    }

    if (attemptEntity.status !== 'in_progress') {
      ctx.throw(400, 'Attempt is not active');
    }

    const generatedQuestionIds = Array.isArray(attemptEntity.generatedQuestionIds)
      ? attemptEntity.generatedQuestionIds.map((v: unknown) => Number(v)).filter((v: number) => Number.isFinite(v))
      : [];

    if (generatedQuestionIds.length === 0) {
      ctx.throw(400, 'Attempt has no generated questions');
    }

    const submittedQuestionIds = rawAnswers
      .map((a) => Number(a.questionId))
      .filter((v) => Number.isFinite(v));

    if (submittedQuestionIds.length !== rawAnswers.length) {
      ctx.throw(400, 'Invalid questionId in answers');
    }

    const submittedUnique = new Set(submittedQuestionIds);
    if (submittedUnique.size !== submittedQuestionIds.length) {
      ctx.throw(400, 'Duplicate questionId in answers');
    }

    const generatedSet = new Set(generatedQuestionIds);
    if (submittedQuestionIds.length !== generatedQuestionIds.length) {
      ctx.throw(400, 'Answers must match generated questions');
    }

    for (const qid of submittedQuestionIds) {
      if (!generatedSet.has(qid)) {
        ctx.throw(400, 'Answers must match generated questions');
      }
    }

    const questions = (await strapi.db.query('api::question.question').findMany({
      where: { id: { $in: generatedQuestionIds } },
      select: ['id', 'type', 'correctAnswer', 'explanation'],
      limit: generatedQuestionIds.length,
    })) as Array<{ id: number; type: string; correctAnswer: unknown; explanation?: string | null }>;

    const questionMap = new Map<number, { type: string; correctAnswer: unknown; explanation?: string | null }>();
    for (const q of questions) {
      questionMap.set(Number(q.id), { type: q.type, correctAnswer: q.correctAnswer, explanation: q.explanation });
    }

    const scorer = strapi.service('api::lesson.scoring') as {
      gradeQuestion: (type: any, response: unknown, correctAnswer: unknown) => {
        isCorrect: boolean | null;
        earnedScore: number;
        expected?: unknown;
      };
    };

    const answerRows: Array<{
      user: number;
      lessonAttempt: number;
      question: number;
      response: unknown;
      isCorrect: boolean | null;
      timeSpent: number | null;
      earnedScore: number;
    }> = [];

    const perQuestionResults: Array<{
      questionId: number;
      isCorrect: boolean | null;
      earnedScore: number;
      expected?: unknown;
      explanation?: string | null;
    }> = [];

    let correctCount = 0;
    let gradableCount = 0;
    let totalTimeSpent = 0;

    for (const a of rawAnswers) {
      const questionId = Number(a.questionId);
      const q = questionMap.get(questionId);
      if (!q) {
        ctx.throw(400, 'Question not found in attempt');
      }

      const timeSpent = typeof a.timeSpent === 'number' && Number.isFinite(a.timeSpent) ? Math.max(0, Math.trunc(a.timeSpent)) : null;
      if (timeSpent !== null) totalTimeSpent += timeSpent;

      const grade = scorer.gradeQuestion(q.type, a.response, q.correctAnswer);

      if (grade.isCorrect !== null) {
        gradableCount += 1;
        if (grade.isCorrect) correctCount += 1;
      }

      answerRows.push({
        user: user.id,
        lessonAttempt: attemptId,
        question: questionId,
        response: a.response ?? null,
        isCorrect: grade.isCorrect,
        timeSpent,
        earnedScore: grade.earnedScore ?? 0,
      });

      perQuestionResults.push({
        questionId,
        isCorrect: grade.isCorrect,
        earnedScore: grade.earnedScore ?? 0,
        expected: grade.expected,
        explanation: q.explanation ?? null,
      });
    }

    const score = gradableCount === 0 ? 0 : Math.round((correctCount / gradableCount) * 100);
    const lessonPassScore =
      typeof attemptEntity.lesson?.passScore === 'number' && Number.isFinite(attemptEntity.lesson.passScore)
        ? attemptEntity.lesson.passScore
        : null;
    const pass = typeof lessonPassScore === 'number' ? score >= lessonPassScore : true;

    const includeDetails = Boolean(body.includeDetails);
    const includeExplanation = typeof body.includeExplanation === 'boolean'
      ? body.includeExplanation
      : Boolean(attemptEntity.lesson?.showExplanationOnSubmit);

    const timeSpentAttempt =
      typeof body.timeSpent === 'number' && Number.isFinite(body.timeSpent)
        ? Math.max(0, Math.trunc(body.timeSpent))
        : totalTimeSpent > 0
          ? totalTimeSpent
          : null;

    await strapi.db.transaction(async () => {
      for (const r of answerRows) {
        await strapi.db.query('api::user-answer.user-answer').create({
          data: {
            user: r.user,
            lessonAttempt: r.lessonAttempt,
            question: r.question,
            response: r.response,
            isCorrect: r.isCorrect,
            timeSpent: r.timeSpent,
            earnedScore: r.earnedScore,
          },
        });
      }

      const updated = await strapi.db.query('api::lesson-attempt.lesson-attempt').update({
        where: { id: attemptId, status: 'in_progress' },
        data: {
          status: 'completed',
          submittedAt: new Date().toISOString(),
          score,
          correctCount,
          totalQuestions: generatedQuestionIds.length,
          timeSpent: timeSpentAttempt,
        },
      });

      if (!updated) {
        ctx.throw(409, 'Attempt already submitted');
      }
    });

    return {
      attemptId,
      score,
      pass,
      correctCount,
      gradableCount,
      totalQuestions: generatedQuestionIds.length,
      results:
        includeDetails
          ? perQuestionResults.map((r) => ({
              questionId: r.questionId,
              isCorrect: r.isCorrect,
              earnedScore: r.earnedScore,
              expected: r.expected,
              explanation: includeExplanation ? r.explanation : undefined,
            }))
          : undefined,
    };
  },
}));
