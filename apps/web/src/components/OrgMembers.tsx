"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "./I18nProvider";
import { useConfirm } from "./ConfirmDialog";
import { fmt } from "@/lib/i18n/shared";

function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Member {
  id: number; email: string; role: "owner" | "admin" | "member";
  department_id: number | null; department_name: string | null;
  joined_at: string; active_keys: number;
}
interface Dept { id: number; name: string; members: number }
interface Invite { id: number; email: string; role: string; department_name: string | null; expires_at: string }

export default function OrgMembers({ role }: { role: "owner" | "admin" }) {
  const { dict } = useI18n();
  const t = dict.console.org.members;
  const tp = dict.console.org.policies;
  const tw = dict.console.ws;
  const { confirm } = useConfirm();
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<number>(0);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [emails, setEmails] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteDept, setInviteDept] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<{ email: string; status: string }[]>([]);
  const [deptName, setDeptName] = useState("");
  const [message, setMessage] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [deptCsvResult, setDeptCsvResult] = useState("");
  const inviteFileRef = useRef<HTMLInputElement>(null);
  const deptFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [m, d, i] = await Promise.all([
      fetch("/api/org/members").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/org/departments").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/org/invites").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (m) { setMembers(m.members); setMe(m.me); }
    if (d) setDepts(d.departments);
    if (i) setInvites(i.invites);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function call(url: string, init: RequestInit): Promise<boolean> {
    setMessage("");
    const r = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
    if (!r.ok) {
      setMessage((await r.json().catch(() => ({}))).error ?? "Failed.");
      return false;
    }
    await load();
    return true;
  }

  async function sendInvites() {
    const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
    if (!list.length || sending) return;
    setSending(true);
    setResults([]);
    const r = await fetch("/api/org/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        emails: list, role: inviteRole,
        departmentId: inviteDept ? Number(inviteDept) : null,
      }),
    });
    setSending(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMessage(j.error ?? "Failed.");
    setResults(j.results ?? []);
    setEmails("");
    await load();
  }

  async function uploadCsv(kind: "invites" | "departments", file: File) {
    if (csvBusy) return;
    setCsvBusy(true);
    setMessage("");
    const r = await fetch(`/api/org/${kind}/bulk`, {
      method: "POST",
      headers: { "content-type": "text/csv" },
      body: await file.text(),
    });
    const j = await r.json().catch(() => ({}));
    setCsvBusy(false);
    if (!r.ok) return setMessage(j.error ?? "Failed.");
    if (kind === "invites") setResults(j.results ?? []);
    else setDeptCsvResult(fmt(t.deptCsvResult, { created: j.created ?? 0, exists: j.exists ?? 0, invalid: j.invalid ?? 0 }));
    await load();
  }

  const roleName = (v: string) => (tw.roles as any)[v] ?? v;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-display-md text-ink">{t.title}</h1>
        <p className="mt-1 text-[16px] text-mute">{t.sub}</p>
      </header>
      {message && <p className="text-[15px] text-error">{message}</p>}

      {/* roster */}
      <section className="card !p-0 overflow-x-auto" data-testid="org-members">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-hairline text-left text-badge text-mute">
              {[t.colEmail, t.colRole, t.colDept, t.colKeys, t.colJoined, ""].map((h, i) => (
                <th key={i} className="px-6 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const self = m.id === me;
              const canRemove = m.role !== "owner" && (role === "owner" || m.role !== "admin") && !self;
              const canRole = m.role !== "owner" && role === "owner";
              const canDept = m.role !== "owner" || true;
              return (
                <tr key={m.id} className="border-b border-hairline last:border-0">
                  <td className="px-6 py-3">
                    {m.email} {self && <span className="ml-1 rounded bg-ink/5 px-1.5 py-0.5 text-badge text-mute">{t.you}</span>}
                  </td>
                  <td className="px-6 py-3">
                    {canRole ? (
                      <select className="input !min-h-[32px] !w-auto !py-1 text-[14px]" value={m.role}
                        onChange={(e) => call("/api/org/members", { method: "PATCH", body: JSON.stringify({ userId: m.id, role: e.target.value }) })}>
                        <option value="admin">{roleName("admin")}</option>
                        <option value="member">{roleName("member")}</option>
                      </select>
                    ) : roleName(m.role)}
                  </td>
                  <td className="px-6 py-3">
                    {canDept ? (
                      <select className="input !min-h-[32px] !w-auto !py-1 text-[14px]" value={m.department_id ?? ""}
                        onChange={(e) => call("/api/org/members", { method: "PATCH", body: JSON.stringify({ userId: m.id, departmentId: e.target.value ? Number(e.target.value) : null }) })}>
                        <option value="">{t.noDept}</option>
                        {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    ) : (m.department_name ?? t.noDept)}
                  </td>
                  <td className="px-6 py-3">{m.active_keys}</td>
                  <td className="px-6 py-3 whitespace-nowrap text-mute">
                    {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-6 py-3 text-right">
                    {canRemove && (
                      <button className="text-[14px] text-error hover:underline"
                        onClick={async () => {
                          if (await confirm(t.removeConfirm, { danger: true })) {
                            void call(`/api/org/members?userId=${m.id}`, { method: "DELETE" });
                          }
                        }}>
                        {t.removeCta}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* invite */}
      <section className="card" data-testid="org-invite">
        <h2 className="text-[19px] font-medium text-ink">{t.inviteTitle}</h2>
        <p className="mt-1 text-[15px] text-mute">{t.inviteSub}</p>
        <textarea className="input mt-4 w-full font-mono text-[14px]" rows={3}
          placeholder={t.invitePlaceholder} value={emails} onChange={(e) => setEmails(e.target.value)} />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-[14px] text-mute">{t.inviteRole}</label>
          <select className="input !min-h-[36px] !w-auto !py-1.5 text-[14px]" value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as any)}>
            <option value="member">{roleName("member")}</option>
            {role === "owner" && <option value="admin">{roleName("admin")}</option>}
          </select>
          <label className="text-[14px] text-mute">{t.inviteDept}</label>
          <select className="input !min-h-[36px] !w-auto !py-1.5 text-[14px]" value={inviteDept}
            onChange={(e) => setInviteDept(e.target.value)}>
            <option value="">{t.noDept}</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="btn-primary !min-h-[36px] !px-4 !py-1.5 text-[14px]" onClick={sendInvites} disabled={sending}>
            {sending ? t.inviteSending : t.inviteCta}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          <span className="text-[14px] text-mute">{t.memberCsvHint}</span>
          <button className="btn-secondary !min-h-[36px] !px-3 !py-1.5 text-[14px]"
            onClick={() => downloadCsv("members.csv", "email,role,department\nalice@example.com,member,Engineering\nbob@example.com,member,\n")}>
            {t.csvTemplate}
          </button>
          <button className="btn-secondary !min-h-[36px] !px-3 !py-1.5 text-[14px]"
            onClick={() => inviteFileRef.current?.click()} disabled={csvBusy}>
            {csvBusy ? t.csvUploading : t.csvUpload}
          </button>
          <input ref={inviteFileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadCsv("invites", f);
              e.target.value = "";
            }} />
        </div>
        {results.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-[14px]">
            {results.map((x, i) => (
              <li key={i} className={x.status === "invited" ? "text-accent-green" : "text-mute"}>
                {x.email} — {(t.inviteResults as any)[x.status] ?? x.status}
              </li>
            ))}
          </ul>
        )}

        <h3 className="mt-8 text-[16px] font-medium text-ink">{t.pendingTitle}</h3>
        {invites.length === 0 ? (
          <p className="mt-2 text-[15px] text-mute">{t.pendingEmpty}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2 text-[15px]">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <span>{i.email}</span>
                <span className="text-mute">{roleName(i.role)}{i.department_name ? ` · ${i.department_name}` : ""}</span>
                <button className="text-[14px] text-error hover:underline"
                  onClick={() => call(`/api/org/invites?id=${i.id}`, { method: "DELETE" })}>
                  {t.revoke}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* departments */}
      <section className="card" data-testid="org-departments">
        <h2 className="text-[19px] font-medium text-ink">{t.deptTitle}</h2>
        <p className="mt-1 text-[15px] text-mute">{t.deptSub}</p>
        <div className="mt-4 flex gap-2">
          <input className="input flex-1" placeholder={t.deptPlaceholder} value={deptName}
            onChange={(e) => setDeptName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && deptName.trim()) {
                if (await call("/api/org/departments", { method: "POST", body: JSON.stringify({ name: deptName.trim() }) })) setDeptName("");
              }
            }} />
          <button className="btn-secondary"
            onClick={async () => {
              if (deptName.trim() &&
                  await call("/api/org/departments", { method: "POST", body: JSON.stringify({ name: deptName.trim() }) })) {
                setDeptName("");
              }
            }}>
            {t.deptAdd}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-[14px] text-mute">{t.deptCsvHint}</span>
          <button className="btn-secondary !min-h-[36px] !px-3 !py-1.5 text-[14px]"
            onClick={() => downloadCsv("departments.csv", "name\nEngineering\nSales\n")}>
            {t.csvTemplate}
          </button>
          <button className="btn-secondary !min-h-[36px] !px-3 !py-1.5 text-[14px]"
            onClick={() => deptFileRef.current?.click()} disabled={csvBusy}>
            {csvBusy ? t.csvUploading : t.csvUpload}
          </button>
          <input ref={deptFileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadCsv("departments", f);
              e.target.value = "";
            }} />
          {deptCsvResult && <span className="text-[14px] text-accent-green">{deptCsvResult}</span>}
        </div>
        <ul className="mt-4 flex flex-col gap-2 text-[15px]">
          {depts.map((d) => (
            <li key={d.id} className="flex items-center gap-3">
              <span className="font-medium text-ink">{d.name}</span>
              <span className="text-mute">{fmt(t.deptMembers, { n: d.members })}</span>
              <button className="text-[14px] text-error hover:underline"
                onClick={async () => {
                  if (await confirm(t.deptDeleteConfirm, { danger: true })) {
                    void call(`/api/org/departments?id=${d.id}`, { method: "DELETE" });
                  }
                }}>
                {tp.deletePolicy}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
