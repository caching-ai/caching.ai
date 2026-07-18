import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/org";
import OrgDashboard from "@/components/OrgDashboard";
import OnboardingChecklist from "@/components/OnboardingChecklist";

export default async function OrgOverviewPage() {
  const ws = await getWorkspace();
  if (!ws) redirect("/login");
  if (!ws.org || (ws.org.role !== "owner" && ws.org.role !== "admin")) redirect("/console");
  // admins land here as their dashboard now — keep the first-run guide with it
  return (
    <div className="flex flex-col gap-8">
      <OnboardingChecklist />
      <OrgDashboard />
    </div>
  );
}
