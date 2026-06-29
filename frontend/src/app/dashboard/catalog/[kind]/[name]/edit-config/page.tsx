import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { EditConfigForm } from "@/components/catalog/edit-config-form";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

export default async function EditConfigPage({
  params,
}: {
  params: Promise<{ kind: string; name: string }>;
}) {
  const { kind, name } = await params;
  const session = await requireSession();
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("wxops_session")?.value ?? "";

  // Fetch entity to get the correct team from spec.owner
  let team = session.groups[0] ?? "";
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/catalog/entities/${kind}/${name}`,
      {
        headers: { Cookie: `wxops_session=${sessionCookie}` },
        cache: "no-store",
      },
    );
    if (res.ok) {
      const entity = await res.json();
      const owner = entity.spec?.owner ?? "";
      team = owner.includes(":") ? owner.split(":")[1] : owner || team;
    } else {
      redirect(`/dashboard/catalog/${kind}/${name}`);
    }
  } catch {
    redirect(`/dashboard/catalog/${kind}/${name}`);
  }

  return (
    <EditConfigForm
      team={team}
      appName={name}
      groups={session.groups}
      entityKind={kind}
    />
  );
}
