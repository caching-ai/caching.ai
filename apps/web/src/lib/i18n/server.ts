import { cookies, headers } from "next/headers";
import { LANG_COOKIE, isLocale, negotiate, type Locale } from "./shared";

/** server-side locale: explicit cookie wins, else browser language, else en */
export async function getLocale(): Promise<Locale> {
  const jar = await cookies();
  const c = jar.get(LANG_COOKIE)?.value;
  if (isLocale(c)) return c;
  const h = await headers();
  return negotiate(h.get("accept-language"));
}
