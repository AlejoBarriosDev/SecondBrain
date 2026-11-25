import type { ReactNode } from "react";
import type { ThemeValue } from "@/lib/ui/theme";
import { DesktopSidebar } from "./DesktopSidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { ThemeServerSync } from "./ThemeProvider";
import { Topbar, type TopbarUser } from "./Topbar";

export function AppShell({
  title,
  subtitle,
  user,
  pendingInboxCount = 0,
  initialTheme,
  children,
}: {
  title: string;
  subtitle?: string;
  user: TopbarUser;
  pendingInboxCount?: number;
  initialTheme?: ThemeValue;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen w-full overflow-x-clip">
      <ThemeServerSync initialTheme={initialTheme} />
      {/* DesktopSidebar MUST render BEFORE MobileBottomNav in DOM order */}
      <DesktopSidebar pendingInboxCount={pendingInboxCount} />

      <div className="flex min-h-screen flex-col lg:pl-64">
        <Topbar title={title} subtitle={subtitle} user={user} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-24 lg:px-8 lg:pb-8">
          {children}
        </main>
      </div>

      <MobileBottomNav pendingInboxCount={pendingInboxCount} />
    </div>
  );
}
