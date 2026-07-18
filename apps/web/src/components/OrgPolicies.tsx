"use client";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "./I18nProvider";
import { useConfirm } from "./ConfirmDialog";

interface Dept { id: number; name: string }
interface Member { id: number; email: string }

type Scope = "org" | "department" | "member";
type Tri = "" | "true" | "false"; // '' = inherit

const usd = (v: number) =>
  "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function OrgPolicies() {
  const { dict } = useI18n();
  const t = dict.console.org.policies;
  const { confirm } = useConfirm();
  const [policies, setPolicies] = useState<any[]>([]);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    const [p, b, d, m] = await Promise.all([
      fetch("/api/org/policies").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/org/budgets").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/org/departments").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/org/members").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (p) setPolicies(p.policies);
    if (b) setBudgets(b.budgets);
    if (d) setDepts(d.departments);
    if (m) setMembers(m.members);
  }, []);
  useEffect(() => { void load(); }, [load]);

  // ---- policy editor state ----
  const [scope, setScope] = useState<Scope>("org");
  const [deptId, setDeptId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [injection, setInjection] = useState<Tri>("");
  const [warming, setWarming] = useState<Tri>("");
  const [budget, setBudget] = useState("");
  const [ttl, setTtl] = useState("");
  const [tuning, setTuning] = useState("");
  const [enforce, setEnforce] = useState(false);

  async function savePolicy() {
    setMessage(""); setSaved("");
    const body: any = { scope, enforce };
    if (scope === "department") body.departmentId = Number(deptId);
    if (scope === "member") body.memberUserId = Number(memberId);
    if (injection !== "") body.auto_cache_control = injection === "true";
    if (warming !== "") body.keepalive_enabled = warming === "true";
    if (budget !== "") body.keepalive_budget_usd_daily = Number(budget);
    if (ttl !== "") body.anthropic_cache_ttl = ttl;
    if (tuning !== "") body.cache_tuning_mode = tuning;
    const r = await fetch("/api/org/policies", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) return setMessage((await r.json().catch(() => ({}))).error ?? "Failed.");
    setSaved(t.saved);
    await load();
  }

  // ---- budget editor state ----
  const [bScope, setBScope] = useState<Scope>("org");
  const [bDeptId, setBDeptId] = useState("");
  const [bMemberId, setBMemberId] = useState("");
  const [bLimit, setBLimit] = useState("");
  const [bAction, setBAction] = useState<"warn" | "block">("warn");
  const [bSaved, setBSaved] = useState("");

  async function saveBudget() {
    setMessage(""); setBSaved("");
    const body: any = { scope: bScope, monthlyLimitUsd: Number(bLimit), action: bAction };
    if (bScope === "department") body.departmentId = Number(bDeptId);
    if (bScope === "member") body.memberUserId = Number(bMemberId);
    const r = await fetch("/api/org/budgets", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) return setMessage((await r.json().catch(() => ({}))).error ?? "Failed.");
    setBSaved(t.saved);
    setBLimit("");
    await load();
  }

  const scopeLabel = (row: any) =>
    row.scope === "org" ? t.scopeOrg
      : row.scope === "department" ? `${t.scopeDept}: ${row.department_name ?? ""}`
        : `${t.scopeMember}: ${row.member_email ?? ""}`;

  const triSelect = (value: Tri, set: (v: Tri) => void) => (
    <select className="input !min-h-[36px] !py-1.5 text-[14px]" value={value} onChange={(e) => set(e.target.value as Tri)}>
      <option value="">{t.inherit}</option>
      <option value="true">{t.on}</option>
      <option value="false">{t.off}</option>
    </select>
  );

  const scopeTargets = (
    s: Scope, dv: string, setD: (v: string) => void, mv: string, setM: (v: string) => void
  ) => (
    <>
      {s === "department" && (
        <select className="input !min-h-[36px] !w-auto !py-1.5 text-[14px]" value={dv} onChange={(e) => setD(e.target.value)}>
          <option value="">{t.pickDept}</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      {s === "member" && (
        <select className="input !min-h-[36px] !w-auto !py-1.5 text-[14px]" value={mv} onChange={(e) => setM(e.target.value)}>
          <option value="">{t.pickMember}</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
        </select>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-display-md text-ink">{t.title}</h1>
        <p className="mt-1 text-[16px] text-mute">{t.sub}</p>
      </header>
      {message && <p className="text-[15px] text-error">{message}</p>}

      {/* existing policies */}
      <section className="card" data-testid="org-policies">
        <h2 className="text-[19px] font-medium text-ink">{t.policyTitle}</h2>
        <p className="mt-1 text-[15px] text-mute">{t.policySub}</p>
        {policies.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2 text-[15px]">
            {policies.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-card border border-hairline px-4 py-2.5">
                <span className="font-medium text-ink">{scopeLabel(p)}</span>
                {p.enforce && <span className="rounded bg-warn/15 px-2 py-0.5 text-badge text-[#8a6100]">{t.enforce}</span>}
                <span className="text-mute">
                  {[
                    p.auto_cache_control != null && `${t.fieldInjection}: ${p.auto_cache_control ? t.on : t.off}`,
                    p.keepalive_enabled != null && `${t.fieldWarming}: ${p.keepalive_enabled ? t.on : t.off}`,
                    p.keepalive_budget_usd_daily != null && `${t.fieldBudget}: ${p.keepalive_budget_usd_daily}`,
                    p.anthropic_cache_ttl && `${t.fieldTtl}: ${p.anthropic_cache_ttl}`,
                    p.cache_tuning_mode && `${t.fieldTuning}: ${p.cache_tuning_mode}`,
                  ].filter(Boolean).join(" · ")}
                </span>
                <button className="ml-auto text-[14px] text-error hover:underline"
                  onClick={async () => {
                    if (await confirm(t.deletePolicyConfirm, { danger: true })) {
                      await fetch(`/api/org/policies?id=${p.id}`, { method: "DELETE" });
                      await load();
                    }
                  }}>
                  {t.deletePolicy}
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* editor */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <select className="input !min-h-[36px] !w-auto !py-1.5 text-[14px]" value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}>
            <option value="org">{t.scopeOrg}</option>
            <option value="department">{t.scopeDept}</option>
            <option value="member">{t.scopeMember}</option>
          </select>
          {scopeTargets(scope, deptId, setDeptId, memberId, setMemberId)}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-[14px] text-mute">{t.fieldInjection}{triSelect(injection, setInjection)}</label>
          <label className="flex flex-col gap-1 text-[14px] text-mute">{t.fieldWarming}{triSelect(warming, setWarming)}</label>
          <label className="flex flex-col gap-1 text-[14px] text-mute">{t.fieldBudget}
            <input className="input !min-h-[36px] !py-1.5 text-[14px]" type="number" min={0} max={1000} step="0.5"
              placeholder={t.inherit} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[14px] text-mute">{t.fieldTtl}
            <select className="input !min-h-[36px] !py-1.5 text-[14px]" value={ttl} onChange={(e) => setTtl(e.target.value)}>
              <option value="">{t.inherit}</option>
              <option value="5m">5m</option>
              <option value="1h">1h</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[14px] text-mute">{t.fieldTuning}
            <select className="input !min-h-[36px] !py-1.5 text-[14px]" value={tuning} onChange={(e) => setTuning(e.target.value)}>
              <option value="">{t.inherit}</option>
              <option value="auto">auto</option>
              <option value="manual">manual</option>
            </select>
          </label>
        </div>
        <label className="mt-4 flex items-center gap-2 text-[15px] text-ink">
          <input type="checkbox" checked={enforce} onChange={(e) => setEnforce(e.target.checked)} />
          {t.enforce}
        </label>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn-primary !min-h-[36px] !px-4 !py-1.5 text-[14px]" onClick={savePolicy}
            disabled={(scope === "department" && !deptId) || (scope === "member" && !memberId)}>
            {t.savePolicy}
          </button>
          {saved && <span className="text-[14px] text-accent-green">{saved}</span>}
        </div>
      </section>

      {/* budgets */}
      <section className="card" data-testid="org-budgets">
        <h2 className="text-[19px] font-medium text-ink">{t.budgetTitle}</h2>
        <p className="mt-1 text-[15px] text-mute">{t.budgetSub}</p>
        {budgets.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2 text-[15px]">
            {budgets.map((b) => {
              const ratio = b.monthly_limit_usd > 0 ? Math.min(1, b.spent_usd / b.monthly_limit_usd) : 0;
              return (
                <li key={b.id} className="rounded-card border border-hairline px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-medium text-ink">{scopeLabel(b)}</span>
                    <span className={`rounded px-2 py-0.5 text-badge ${b.action === "block" ? "bg-error/10 text-error" : "bg-ink/5 text-mute"}`}>
                      {b.action === "block" ? t.actionBlock : t.actionWarn}
                    </span>
                    <span className="text-mute">
                      {usd(b.spent_usd)} / {usd(b.monthly_limit_usd)} · {t.budgetSpent}
                    </span>
                    <button className="ml-auto text-[14px] text-error hover:underline"
                      onClick={async () => {
                        if (await confirm(t.deleteBudgetConfirm, { danger: true })) {
                          await fetch(`/api/org/budgets?id=${b.id}`, { method: "DELETE" });
                          await load();
                        }
                      }}>
                      {t.deletePolicy}
                    </button>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded bg-ink/5">
                    <div className={`h-full rounded ${ratio >= 1 ? "bg-error" : ratio >= 0.8 ? "bg-warn" : "bg-accent-green"}`}
                      style={{ width: `${ratio * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <select className="input !min-h-[36px] !w-auto !py-1.5 text-[14px]" value={bScope}
            onChange={(e) => setBScope(e.target.value as Scope)}>
            <option value="org">{t.scopeOrg}</option>
            <option value="department">{t.scopeDept}</option>
            <option value="member">{t.scopeMember}</option>
          </select>
          {scopeTargets(bScope, bDeptId, setBDeptId, bMemberId, setBMemberId)}
          <input className="input !min-h-[36px] !w-32 !py-1.5 text-[14px]" type="number" min={1}
            placeholder={t.budgetLimit} value={bLimit} onChange={(e) => setBLimit(e.target.value)} />
          <select className="input !min-h-[36px] !w-auto !py-1.5 text-[14px]" value={bAction}
            onChange={(e) => setBAction(e.target.value as any)}>
            <option value="warn">{t.actionWarn}</option>
            <option value="block">{t.actionBlock}</option>
          </select>
          <button className="btn-primary !min-h-[36px] !px-4 !py-1.5 text-[14px]" onClick={saveBudget}
            disabled={!bLimit || (bScope === "department" && !bDeptId) || (bScope === "member" && !bMemberId)}>
            {t.saveBudget}
          </button>
          {bSaved && <span className="text-[14px] text-accent-green">{bSaved}</span>}
        </div>
      </section>
    </div>
  );
}
