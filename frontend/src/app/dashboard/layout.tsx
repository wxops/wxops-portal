import { requireSession } from "@/lib/session";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/topbar";
import { CommandPalette } from "@/components/layout/command-palette";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar groups={session.groups} />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar user={session} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      {/* Global Ctrl/Cmd+K command palette — renders null when closed */}
      <CommandPalette />
    </div>
  );
}
