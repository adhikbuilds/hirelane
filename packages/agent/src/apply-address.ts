/**
 * The one address a student gives employers: `handle+reply_handle@domain`. Forms are filled with it, the student is shown
 * it, and inbound:scan accepts only mail whose envelope recipient carries that tag, so all three must use this helper.
 */
export function applyAddressOf(a: { handle: string; replyHandle: string; domain: string }): string {
  return `${a.handle}+${a.replyHandle}@${a.domain}`.toLowerCase();
}
