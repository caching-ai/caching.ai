import Dashboard from "@/components/Dashboard";
import OnboardingChecklist from "@/components/OnboardingChecklist";

export default function ConsolePage() {
  return (
    <div className="flex flex-col gap-8">
      <OnboardingChecklist />
      <Dashboard />
    </div>
  );
}
