import { requireSession } from "@/lib/session";
import { RegisterEntityForm } from "@/components/catalog/register-entity-form";

export default async function RegisterEntityPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; relatedTo?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  return (
    <RegisterEntityForm
      groups={session.groups}
      username={session.username}
      initialKind={params.kind}
      initialRelatedTo={params.relatedTo}
    />
  );
}
