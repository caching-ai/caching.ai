import type { LegalSet } from "./types";
import { en } from "./en";
import { ko } from "./ko";
import { ja } from "./ja";
import { zh } from "./zh";
import { es } from "./es";

const SETS: Record<string, LegalSet> = { en, ko, ja, zh, es };

export function getLegal(locale: string): LegalSet {
  return SETS[locale] ?? en;
}
export type { LegalSet, LegalDoc } from "./types";
