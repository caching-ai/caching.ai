import type { LegalSet } from "./types";

export const en: LegalSet = {
  terms: {
    title: "Terms of Service",
    updated: "Last updated: July 17, 2026",
    sections: [
      {
        h: "1. The service",
        body: [
          "Caching.ai (the \"Service\") is a proxy for large-language-model APIs, operated by AI3 Inc. (\"we\", \"us\"). You point your SDK at our endpoint with your own provider API keys; we forward your requests, measure cache usage, protect and optionally re-warm your prompt cache, and report savings on your dashboard.",
          "The Service sits between your application and your AI provider. Your contract with each provider (Anthropic, OpenAI, Google, xAI, and others) remains your own — using the Service does not change your obligations to them.",
        ],
      },
      {
        h: "2. Accounts",
        body: [
          "You need an account to use the Service. You are responsible for the activity that happens under your account and for keeping your credentials and Caching.ai keys confidential. You must provide accurate information and be legally able to enter into this agreement.",
        ],
      },
      {
        h: "3. Fees and billing",
        body: [
          "Pricing is performance-based: each calendar month we compute your verified savings against provider list prices, subtract the cost of any keep-alive requests we sent on your behalf, and charge 20% of the remaining net savings to your registered payment method after the month closes.",
          "Monthly fees under $5 are waived and never carried over. If no savings are verified, no fee is charged. Fees are exclusive of taxes; where required, taxes are added at the applicable rate.",
          "Savings figures are computed from provider-reported token usage and published list prices. Your dashboard shows the running amount throughout the month.",
        ],
      },
      {
        h: "4. Your responsibilities",
        body: [
          "You must use the Service only with provider accounts you are authorized to use, and in compliance with each provider's terms and applicable law. You must not use the Service to send unlawful content, to probe or disrupt the Service, or to resell it without our written consent.",
          "You are responsible for the provider API keys you register. You can remove them at any time in the console.",
        ],
      },
      {
        h: "5. Data handling",
        body: [
          "By default we store token counts, model names, latency, status codes, and hashes of prompt-prefix blocks — not the content of your prompts or responses. If you enable the optional keep-alive feature, we store your prompt prefix (system prompt, tools, and messages up to the last cache breakpoint) encrypted with AES-256-GCM, solely to re-warm your cache; this trade-off is stated on the toggle, and turning it off deletes the stored prefix immediately.",
          "Details are described in our Privacy Policy.",
        ],
      },
      {
        h: "6. Availability and disclaimers",
        body: [
          "The Service is provided \"as is\" and \"as available\". We do not guarantee uninterrupted operation, and savings figures are estimates based on provider-reported usage and list prices. To the maximum extent permitted by law, we disclaim all implied warranties, including merchantability and fitness for a particular purpose.",
        ],
      },
      {
        h: "7. Limitation of liability",
        body: [
          "To the maximum extent permitted by law, our aggregate liability arising out of or relating to the Service is limited to the fees you paid us in the three months preceding the claim. We are not liable for indirect, incidental, special, or consequential damages, or for loss of profits, data, or goodwill.",
        ],
      },
      {
        h: "8. Suspension and termination",
        body: [
          "You may stop using the Service and delete your account at any time. We may suspend or terminate accounts that violate these terms or create risk for the Service or other users. Accrued fees remain payable on termination.",
        ],
      },
      {
        h: "9. Changes",
        body: [
          "We may update these terms as the Service evolves. For material changes we will give notice on the site or by email before they take effect. Continuing to use the Service after the effective date means you accept the updated terms.",
        ],
      },
      {
        h: "10. Governing law and contact",
        body: [
          "These terms are governed by the laws of the Republic of Korea, without regard to conflict-of-law rules. Questions? Contact us at support@caching.ai.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updated: "Last updated: July 17, 2026",
    sections: [
      {
        h: "1. What we collect",
        body: [
          "Account data: your email address, a hashed password (or the email from your Google account if you sign in with Google), and your language preference.",
          "Usage metadata: per-request token counts, model names, latency, status codes, and hashes of prompt-prefix blocks — used to compute hit rates, savings, and waste.",
          "Provider API keys you register, encrypted at rest with AES-256-GCM and used only to forward your requests.",
          "Billing data: your payment method is held by our payment processors (Stripe, or Toss Payments for Korean users) as a token. We never see or store full card numbers.",
        ],
      },
      {
        h: "2. What we do not collect",
        body: [
          "We do not store the content of your prompts or responses. The one exception is the optional keep-alive feature: when you enable it, we store your prompt prefix — the system prompt, tools, and messages up to the last cache breakpoint — encrypted with AES-256-GCM, solely to re-warm your provider cache. Disable the toggle (or revoke the key) and the stored prefix is deleted immediately.",
        ],
      },
      {
        h: "3. Why we process it",
        body: [
          "To operate the proxy and your dashboard, to compute performance-based fees, to send transactional email (verification, receipts) and — unless you opt out — a periodic savings report, and to keep the Service secure.",
        ],
      },
      {
        h: "4. Retention",
        body: [
          "Account data is kept while your account exists. Request metadata is kept for as long as needed to provide analytics and billing history. When you delete your account, associated personal data is deleted or irreversibly anonymized within 30 days, except where law requires longer retention (e.g., billing records).",
        ],
      },
      {
        h: "5. Sharing and processors",
        body: [
          "We do not sell personal data. We share data only with processors needed to run the Service: cloud hosting, payment processors (Stripe, Toss Payments), and our transactional email provider. Each processes data only on our instructions.",
        ],
      },
      {
        h: "6. Security",
        body: [
          "All traffic is encrypted in transit (TLS). Provider keys and opt-in prompt prefixes are encrypted at rest with AES-256-GCM. For the hosted service, access to production data is restricted to a minimal set of operators.",
        ],
      },
      {
        h: "7. Your rights",
        body: [
          "You can access, correct, export, or delete your data. Keys, provider keys, cards, and the account itself can be deleted directly in the console; for anything else, email support@caching.ai and we will respond promptly. You can opt out of report emails with one click in any report.",
        ],
      },
      {
        h: "8. International users",
        body: [
          "The Service is operated from the Republic of Korea. By using it you understand your data is processed there and by the processors listed above.",
        ],
      },
      {
        h: "9. Changes and contact",
        body: [
          "We will post updates to this policy here and, for material changes, notify you on the site or by email. Contact: support@caching.ai.",
        ],
      },
    ],
  },
};
