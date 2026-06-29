import { requireSession } from "@/lib/session";
import { ProjectWizard } from "@/components/scaffold/project-wizard";

export default async function NewProjectPage() {
  const session = await requireSession();
  const ownerGroups = session.groups.filter((g) => !g.includes(":"));
  return <ProjectWizard groups={ownerGroups} username={session.username} />;
}
