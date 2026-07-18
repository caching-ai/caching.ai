import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/org";
import OrgSettings from "@/components/OrgSettings";

export default async function OrgSettingsPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/login");
  if (!ws.org || (ws.org.role !== "owner" && ws.org.role !== "admin")) redirect("/console");
  return <OrgSettings orgName={ws.org.orgName} role={ws.org.role} />;
}
