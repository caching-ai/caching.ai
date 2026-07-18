import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/org";
import OrgDashboard from "@/components/OrgDashboard";

export default async function OrgOverviewPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/login");
  if (!ws.org || (ws.org.role !== "owner" && ws.org.role !== "admin")) redirect("/console");
  return <OrgDashboard />;
}
