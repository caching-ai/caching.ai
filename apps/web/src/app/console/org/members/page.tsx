import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/org";
import OrgMembers from "@/components/OrgMembers";

export default async function OrgMembersPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/login");
  if (!ws.org || (ws.org.role !== "owner" && ws.org.role !== "admin")) redirect("/console");
  return <OrgMembers role={ws.org.role} />;
}
