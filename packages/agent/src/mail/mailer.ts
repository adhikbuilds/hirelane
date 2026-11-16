/** Outbound mail contract. Slice 2 ships a file outbox only; a real transport is a later owner decision. */
export interface MailMessage {
  /** One mailbox, for example `student@example.test`. */
  to: string;
  subject: string;
  /** Plain text. No HTML in transactional mail. */
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ id: string }>;
}

const ADDRESS = /^[^\s@,;<>"()[\]\\]+@[^\s@,;<>"()[\]\\]+\.[^\s@,;<>"()[\]\\]+$/;

/** Throws unless `to` is a single plain mailbox with no control characters. */
export function assertMailbox(to: string): void {
  if (to.length > 254 || !ADDRESS.test(to)) throw new Error('mail: invalid recipient address');
}

/** Throws when a header value could start a new header line. */
export function assertHeaderValue(name: string, value: string): void {
  if (/[\r\n\0]/.test(value)) throw new Error(`mail: ${name} contains a line break`);
}
