import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/org";
import OrgAudit from "@/components/OrgAudit";

export default async function OrgAuditPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/login");
  if (!ws.org || (ws.org.role !== "owner" && ws.org.role !== "admin")) redirect("/console");
  return <OrgAudit />;
}
