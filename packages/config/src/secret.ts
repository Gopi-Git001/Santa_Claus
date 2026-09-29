import { inspect } from "node:util";

const REDACTED = "[REDACTED]";

/**
 * A secret value that refuses to serialise itself. String conversion, JSON and
 * `util.inspect` all yield "[REDACTED]"; only an explicit `reveal()` returns the
 * raw value, which keeps accidental logging/evidence leaks out (P00 spec §22).
 */
export class SecretString {
  readonly #value: string;
  readonly name: string;

  constructor(name: string, value: string) {
    this.name = name;
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return `SecretString(${this.name}: ${REDACTED})`;
  }
}
