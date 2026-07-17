import KeyManager from "@/components/KeyManager";

export default function KeysPage() {
  return <KeyManager proxyUrl={process.env.NEXT_PUBLIC_PROXY_URL ?? "https://proxy.caching.ai"} />;
}
