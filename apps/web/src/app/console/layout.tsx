import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import LogoutButton from "@/components/LogoutButton";
import DeleteAccount from "@/components/DeleteAccount";
import ConsoleNav from "@/components/ConsoleNav";
import LangSelector from "@/components/LangSelector";
import VerifyBanner from "@/components/VerifyBanner";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const sess = await getSession();
  if (!sess) redirect("/login");

  let verified = true;
  try {
    const { rows } = await db().query("SELECT email_verified_at FROM users WHERE id=$1", [sess.uid]);
    verified = !!rows[0]?.email_verified_at;
  } catch {
    // never block the console on a read failure
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* sticky + h-screen keeps the bottom block (locale/email/logout) pinned
          to the visible viewport instead of the end of the page scroll */}
      <aside className="flex w-full shrink-0 flex-col border-b border-hairline md:sticky md:top-0 md:h-screen md:w-60 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="px-6 py-5">
          <Link href="/" aria-label="caching.ai">
            <img src="/logo.png" alt="caching.ai" className="h-8 w-auto" />
          </Link>
        </div>
        <ConsoleNav />
        <div className="mt-auto hidden flex-col gap-3 px-6 py-5 md:flex">
          <LangSelector compact />
          <span className="truncate text-[14px] text-mute">{sess.email}</span>
          <LogoutButton />
          <DeleteAccount />
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-canvas px-6 py-8 md:px-10">
        <VerifyBanner verified={verified} />
        {children}
      </main>
    </div>
  );
}
