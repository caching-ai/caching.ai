import Link from "next/link";
import Footer from "@/components/Footer";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/shared";
import { getLegal } from "@/lib/legal";

export default async function TermsPage() {
  const locale = await getLocale();
  const d = getDict(locale);
  const doc = getLegal(locale).terms;

  return (
    <main>
      <nav className="border-b border-hairline">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-6">
          <Link href="/" aria-label="caching.ai">
            <img src="/logo.png" alt="caching.ai" className="h-8 w-auto" />
          </Link>
        </div>
      </nav>
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-display-lg text-ink">{doc.title}</h1>
        <p className="mt-3 text-[15px] text-mute">{doc.updated}</p>
        {doc.sections.map((s) => (
          <section key={s.h} className="mt-10">
            <h2 className="text-[21px] font-medium text-ink">{s.h}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="mt-3 text-[16px] leading-relaxed text-body">{p}</p>
            ))}
          </section>
        ))}
      </article>
      <Footer d={d} locale={locale} />
    </main>
  );
}
