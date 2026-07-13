import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; name: string }> },
) {
  const { kind, name } = await params;
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  let res: Response;
  try {
    res = await fetch(
      `${BACKEND_URL}/api/v1/catalog/entities/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/content`,
      {
        headers: { Cookie: `wxops_session=${session}` },
        cache: "no-store",
      },
    );
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); if (j.error) msg = j.error; } catch { /* not JSON */ }
    return NextResponse.json({ error: msg }, { status: res.status });
  }

  const text = await res.text();
  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
