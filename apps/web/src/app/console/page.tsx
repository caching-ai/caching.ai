import { redirect } from "next/navigation";
import { getWorkspace } from "@/lib/org";
import Dashboard from "@/components/Dashboard";
import OnboardingChecklist from "@/components/OnboardingChecklist";

export default async function ConsolePage() {
  // In the team workspace, admins land on the TEAM dashboard — the personal
  // dashboard next to it read as a confusing duplicate. Members keep this
  // page as "my usage" (their own keys inside the org).
  const ws = await getWorkspace();
  if (ws?.org && (ws.org.role === "owner" || ws.org.role === "admin")) redirect("/console/org");
  return (
    <div className="flex flex-col gap-8">
      <OnboardingChecklist />
      <Dashboard />
    </div>
  );
}
