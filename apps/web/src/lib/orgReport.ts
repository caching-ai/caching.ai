import path from "node:path";
import fs from "node:fs";

// Shared data shape for the org report exporters (xlsx + pdf). The stats are
// fetched with the same queries as /api/org/stats — the exporters receive the
// already-aggregated JSON to keep one source of truth.

export interface OrgReportData {
  orgName: string;
  windowDays: number;
  generatedAt: string;
  locale: string;
  totals: {
    requests: number; savedUsd: number; wastedUsd: number; costUsd: number;
    hitRate: number; sharedSavedUsd: number; sharedHits: number;
    keepaliveCost: number; keepalivePings: number;
  };
  days: { day: string; requests: number; saved: number; wasted: number; cost: number; hitRate: number }[];
  departments: { department: string | null; requests: number; hitRate: number; cost: number; saved: number; wasted: number }[];
  members: { email: string; department: string | null; requests: number; hitRate: number; cost: number; saved: number; wasted: number; sharedSavedUsd: number }[];
  models: { model: string; requests: number; hitRate: number; cost: number; saved: number; wasted: number }[];
}

export const REPORT_STRINGS: Record<string, Record<string, string>> = {
  en: {
    title: "Team cache report",
    window: "Window",
    days: "days",
    generated: "Generated",
    summary: "Summary",
    requests: "Requests",
    saved: "Saved by caching",
    wasted: "Still leaking",
    spend: "Provider spend",
    hitRate: "Cache hit rate",
    shared: "Shared-cache savings",
    sharedNote: "Savings from teammates reusing each other's warmed cache",
    keepalive: "Cache Warmer spend",
    byDepartment: "By department",
    byMember: "By member",
    byModel: "By model",
    byDay: "Daily",
    department: "Department",
    member: "Member",
    model: "Model",
    day: "Day",
    unassigned: "(unassigned)",
    footer: "caching.ai — automatic LLM cache management",
  },
  ko: {
    title: "팀 캐시 리포트",
    window: "기간",
    days: "일",
    generated: "생성",
    summary: "요약",
    requests: "요청 수",
    saved: "캐싱으로 절감",
    wasted: "아직 새는 돈",
    spend: "프로바이더 지출",
    hitRate: "캐시 히트율",
    shared: "공유 캐시 절감",
    sharedNote: "팀원이 서로 데운 캐시를 읽어 아낀 금액",
    keepalive: "캐시 워머 지출",
    byDepartment: "부서별",
    byMember: "멤버별",
    byModel: "모델별",
    byDay: "일별",
    department: "부서",
    member: "멤버",
    model: "모델",
    day: "날짜",
    unassigned: "(미지정)",
    footer: "caching.ai — AI 캐시 자동 관리",
  },
};

export function reportT(locale: string): Record<string, string> {
  return REPORT_STRINGS[locale] ?? REPORT_STRINGS.en;
}

/** public/fonts works in dev (cwd=apps/web) and in the standalone image
 *  (server.js chdirs next to public/). */
export function fontPath(name: string): string | null {
  const p = path.join(process.cwd(), "public", "fonts", name);
  return fs.existsSync(p) ? p : null;
}

export const usd = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 10 ? 4 : 2 });
export const pct = (v: number) => (v * 100).toFixed(1) + "%";
