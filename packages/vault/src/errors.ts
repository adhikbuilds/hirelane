/** Every vault failure. Messages never contain keys, plaintext or blob contents. */
export class VaultError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VaultError';
  }
}

export class BlobNotFoundError extends VaultError {
  constructor() {
    super('blob not found');
    this.name = 'BlobNotFoundError';
  }
}
