import type { Core } from '@strapi/strapi';

type QuestionType =
  | 'multiple_choice'
  | 'single_choice'
  | 'fill_blank'
  | 'true_false'
  | 'short_answer'
  | 'listening'
  | 'matching';

type CorrectAnswerShape =
  | { answerId?: unknown; answer?: unknown; answers?: unknown }
  | unknown;

type GradeResult = {
  isCorrect: boolean | null;
  earnedScore: number;
  expected?: unknown;
};

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const extractAnswerId = (value: unknown): string => {
  if (typeof value === 'string') return value.trim().toUpperCase();
  if (value && typeof value === 'object' && 'answerId' in (value as any)) {
    const v = (value as any).answerId;
    if (typeof v === 'string') return v.trim().toUpperCase();
  }
  if (value && typeof value === 'object' && 'id' in (value as any)) {
    const v = (value as any).id;
    if (typeof v === 'string') return v.trim().toUpperCase();
  }
  return '';
};

const extractBooleanAnswer = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'answer' in (value as any)) {
    const v = (value as any).answer;
    if (typeof v === 'boolean') return v;
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
};

const extractTextAnswer = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'answer' in (value as any)) {
    const v = (value as any).answer;
    if (typeof v === 'string') return v;
  }
  return '';
};

const extractCorrect = (correctAnswer: CorrectAnswerShape): { answerId?: string; answer?: unknown; answers?: unknown } => {
  if (correctAnswer && typeof correctAnswer === 'object') {
    const o = correctAnswer as any;
    return {
      answerId: typeof o.answerId === 'string' ? o.answerId : undefined,
      answer: o.answer,
      answers: o.answers,
    };
  }
  return {};
};

const gradeMultipleChoice = (response: unknown, correctAnswer: CorrectAnswerShape): GradeResult => {
  const expectedId = extractAnswerId(extractCorrect(correctAnswer).answerId ?? correctAnswer);
  if (!expectedId) return { isCorrect: null, earnedScore: 0, expected: null };
  const selectedId = extractAnswerId(response);
  if (!selectedId) return { isCorrect: false, earnedScore: 0, expected: { answerId: expectedId } };
  const isCorrect = selectedId === expectedId;
  return { isCorrect, earnedScore: isCorrect ? 1 : 0, expected: { answerId: expectedId } };
};

const gradeFillBlank = (response: unknown, correctAnswer: CorrectAnswerShape): GradeResult => {
  const expected = extractCorrect(correctAnswer).answer;
  const expectedText = normalizeText(expected);
  if (!expectedText) return { isCorrect: null, earnedScore: 0, expected: null };
  const given = normalizeText(extractTextAnswer(response));
  if (!given) return { isCorrect: false, earnedScore: 0, expected: { answer: expected } };
  const isCorrect = given === expectedText;
  return { isCorrect, earnedScore: isCorrect ? 1 : 0, expected: { answer: expected } };
};

const gradeTrueFalse = (response: unknown, correctAnswer: CorrectAnswerShape): GradeResult => {
  const expected = extractCorrect(correctAnswer).answer;
  if (typeof expected !== 'boolean') return { isCorrect: null, earnedScore: 0, expected: null };
  const given = extractBooleanAnswer(response);
  if (given === null) return { isCorrect: false, earnedScore: 0, expected: { answer: expected } };
  const isCorrect = given === expected;
  return { isCorrect, earnedScore: isCorrect ? 1 : 0, expected: { answer: expected } };
};

const gradeShortAnswer = (response: unknown, correctAnswer: CorrectAnswerShape): GradeResult => {
  const expected = extractCorrect(correctAnswer).answer;
  const expectedText = normalizeText(expected);
  if (!expectedText) return { isCorrect: null, earnedScore: 0, expected: null };
  if (expectedText.startsWith('example:')) return { isCorrect: null, earnedScore: 0, expected: { answer: expected } };
  const given = normalizeText(extractTextAnswer(response));
  if (!given) return { isCorrect: false, earnedScore: 0, expected: { answer: expected } };
  const isCorrect = given === expectedText;
  return { isCorrect, earnedScore: isCorrect ? 1 : 0, expected: { answer: expected } };
};

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  gradeQuestion(type: QuestionType, response: unknown, correctAnswer: CorrectAnswerShape): GradeResult {
    switch (type) {
      case 'multiple_choice':
      case 'single_choice':
        return gradeMultipleChoice(response, correctAnswer);
      case 'fill_blank':
        return gradeFillBlank(response, correctAnswer);
      case 'true_false':
        return gradeTrueFalse(response, correctAnswer);
      case 'short_answer':
        return gradeShortAnswer(response, correctAnswer);
      case 'listening':
        return gradeFillBlank(response, correctAnswer);
      case 'matching':
        return { isCorrect: null, earnedScore: 0, expected: null };
      default:
        return { isCorrect: null, earnedScore: 0, expected: null };
    }
  },
});

