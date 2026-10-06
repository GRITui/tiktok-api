/** Domain error with an HTTP-friendly status and a stable machine code. */
export class OmsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "OmsError";
  }
}

export const notImplemented = (what: string): never => {
  throw new OmsError("not_implemented", `${what} is not implemented yet`, 501);
};
