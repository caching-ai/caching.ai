import Billing from "@/components/Billing";

export default function BillingPage() {
  // read at request time on the server — NEXT_PUBLIC_ inlining doesn't work
  // with runtime-injected env on standalone builds
  return <Billing tossClientKey={process.env.TOSS_CLIENT_KEY ?? ""} />;
}
