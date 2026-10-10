import argon2 from "argon2";

export const hashPassword = (password: string) => argon2.hash(password);

export async function verifyPassword(hash: string, password: string) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Burns equivalent time when the user does not exist, to blunt timing probes. */
export async function verifyDummy(password: string) {
  dummyHash ??= argon2.hash("dummy-password-for-timing");
  await verifyPassword(await dummyHash, password);
}
