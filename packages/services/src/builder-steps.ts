import { z } from 'zod';

/**
 * Guided-builder answers (Amendment B section 6), one zod schema per question. The union of the answers is the runner's
 * BuilderAnswers shape (workers/runner/src/resume/render/answers.ts): the same fields and limits, so what services accept
 * is what resume:render can lay out. Keep the two in step.
 */
const str = (min: number, max: number) => z.string().trim().min(min).max(max);
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,4}$/;
const PHONE = /^(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/;
const URLISH = /^(?:https?:\/\/)?[A-Za-z0-9.-]{1,80}\.[A-Za-z]{2,}(?:\/[^\s]{0,100})?$/;
const url = str(4, 120).regex(URLISH);
const bullets = z.array(str(3, 200)).min(1).max(4);

export const BUILDER_STEPS = ['contact', 'education', 'skills', 'projects', 'experience', 'links', 'summary'] as const;
export type BuilderStep = (typeof BUILDER_STEPS)[number];
/** Needed before a render. experience, links and summary are optional. */
export const BUILDER_REQUIRED: readonly BuilderStep[] = ['contact', 'education', 'skills', 'projects'];

export const StepData = {
  contact: z.strictObject({ name: str(2, 60), email: str(3, 120).regex(EMAIL), phone: str(10, 18).regex(PHONE), city: str(1, 40).optional() }),
  education: z.strictObject({
    education: z.array(z.strictObject({ qualification: str(2, 80), institution: str(2, 80), year: str(4, 9), score: str(1, 30).optional() })).min(1).max(3),
  }),
  skills: z.strictObject({ skills: z.array(str(1, 30)).min(3).max(20) }),
  projects: z.strictObject({ projects: z.array(z.strictObject({ title: str(2, 80), link: url.optional(), bullets })).min(1).max(3) }),
  experience: z.strictObject({
    experience: z.array(z.strictObject({ role: str(2, 60), org: str(2, 80), period: str(1, 40).optional(), bullets })).max(2),
  }),
  links: z.strictObject({ links: z.array(url).max(3) }),
  summary: z.strictObject({ summary: str(1, 240) }),
} as const;

/** Which answer keys each step owns, so a step can tell which of its answers are present. */
export const STEP_KEYS: Record<BuilderStep, readonly string[]> = {
  contact: ['name', 'email', 'phone', 'city'],
  education: ['education'],
  skills: ['skills'],
  projects: ['projects'],
  experience: ['experience'],
  links: ['links'],
  summary: ['summary'],
};

/** The whole answer set, as the renderer reads it. */
export const BuilderAnswersSchema = z.strictObject({
  ...StepData.contact.shape,
  ...StepData.education.shape,
  ...StepData.skills.shape,
  ...StepData.projects.shape,
  experience: StepData.experience.shape.experience.optional(),
  links: StepData.links.shape.links.optional(),
  summary: StepData.summary.shape.summary.optional(),
});
