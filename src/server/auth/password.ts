import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id med OWASP:s miniminivå (19 MiB, 2 pass, 1 tråd). Parametrarna ligger i
 * själva hashen, så de kan höjas senare utan att gamla lösenord slutar fungera.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/** Returnerar false vid fel hash eller fel lösenord (kastar aldrig på ogiltig hash). */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Null om lösenordet är godkänt, annars ett meddelande på svenska. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Lösenordet måste vara minst ${PASSWORD_MIN_LENGTH} tecken.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Lösenordet får vara högst ${PASSWORD_MAX_LENGTH} tecken.`;
  }
  if (new Set(password).size < 5) {
    return "Lösenordet är för enkelt. Använd fler olika tecken.";
  }
  return null;
}

let dummyHash: Promise<string> | undefined;

/** Hash att jämföra mot när användaren inte finns, så svarstiden inte avslöjar om kontot finns. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalization");
  return dummyHash;
}
