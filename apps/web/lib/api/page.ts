import { getEligibility, getMe, getResume, listResumes } from "@hirelane/services";
import { withPageCtx } from "./action";

/** Typed readers for the student pages. Each returns null when nobody is signed in; a missing or foreign id throws a 404 ServiceError. */
export const loadMe = () => withPageCtx((ctx) => getMe(ctx));
export const loadResumes = () => withPageCtx((ctx) => listResumes(ctx));
export const loadResume = (id: string) => withPageCtx((ctx) => getResume(ctx, { id }));
export const loadEligibility = () => withPageCtx((ctx) => getEligibility(ctx));
