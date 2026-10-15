// Stub: real session lookup (cookie __Host-hl_session) arrives in Phase 4.
export type Session = { userId: string };

export async function getSession(): Promise<Session | null> {
  return null;
}
