import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { tokenKey as key } from "./keys";
import { titleTarget, language } from "./schema";

const candidate = z.object({ target: titleTarget, engineId: z.string(), providerRef: z.string().regex(/^sub_\d+_[a-z]{2}_\d+$/), lang: language, label: z.string().max(100) });
export type Candidate = z.infer<typeof candidate>;

export async function signCandidate(data: Candidate, userId: string) {
  return new SignJWT(data).setProtectedHeader({ alg: "HS256" }).setAudience("subtitle-candidate").setSubject(userId).setIssuedAt().setExpirationTime("30m").sign(await key());
}

export async function readCandidate(ref: string, userId: string): Promise<Candidate | null> {
  try {
    const { payload } = await jwtVerify(ref, await key(), { algorithms: ["HS256"], audience: "subtitle-candidate", subject: userId });
    return candidate.parse(payload);
  } catch { return null; }
}
