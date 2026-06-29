import { requireSession } from "@/lib/session";
import { ImportWizard } from "@/components/scaffold/import-wizard";

export default async function ImportProjectPage() {
  const session = await requireSession();
  const ownerGroups = session.groups.filter((g) => !g.includes(":"));
  return <ImportWizard groups={ownerGroups} username={session.username} />;
}
