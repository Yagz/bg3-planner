/** Raised when an export string or a readable JSON document cannot be turned into a run. */
export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodecError";
  }
}
