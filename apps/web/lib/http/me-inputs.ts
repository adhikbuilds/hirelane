import { z } from "zod";
import { SELF_CONSENT_KINDS } from "../auth/session";

/** Body of DELETE /api/v1/me (twin of deleteMyAccount). Deleting is irreversible, so it must say so. */
export const DeleteMeInput = z.strictObject({ confirm: z.literal(true) });
/** Body of POST /api/v1/me/consents (twin of setConsent). age_18_plus is written at sign-up only and is not accepted. */
export const ConsentInput = z.strictObject({ kind: z.enum(SELF_CONSENT_KINDS), granted: z.boolean() });
export const DeleteMeResult = z.object({ deleted: z.literal(true) });
export const ConsentResult = z.object({ ok: z.literal(true) });
