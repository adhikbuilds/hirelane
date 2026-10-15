/** The engine's only error type. Raised on programmer or data errors (overflow, bad index, bad FX string), never on unparseable input. */
export class EngineInvariantError extends Error {
  readonly ruleId: string;
  constructor(ruleId: string, message: string) {
    super(message);
    this.name = 'EngineInvariantError';
    this.ruleId = ruleId;
  }
}
