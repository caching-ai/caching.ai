import type { Metadata } from "next";
import "./globals.css";
import { getLocale } from "@/lib/i18n/server";
import { getDict } from "@/lib/i18n/shared";
import { I18nProvider } from "@/components/I18nProvider";
import ConfirmProvider from "@/components/ConfirmDialog";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const dict = getDict(locale);
  return {
    metadataBase: new URL("https://caching.ai"),
    title: dict.meta.title,
    description: dict.meta.description,
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.description,
      url: "https://caching.ai",
      siteName: "Caching.ai",
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: dict.meta.title,
      description: dict.meta.description,
      images: ["/og.png"],
    },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const dict = getDict(locale);
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inconsolata:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        {locale === "ko" && (
          <link
            rel="stylesheet"
            href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          />
        )}
      </head>
      <body>
        <I18nProvider locale={locale} dict={dict}>
          <ConfirmProvider>{children}</ConfirmProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
