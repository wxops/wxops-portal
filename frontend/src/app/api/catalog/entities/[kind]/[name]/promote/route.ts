import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string; name: string }> },
) {
  const { kind, name } = await params;
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(
      `${BACKEND_URL}/api/v1/catalog/entities/${encodeURIComponent(kind)}/${encodeURIComponent(name)}/promote`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `wxops_session=${session}`,
        },
        body: JSON.stringify(body),
      },
    );
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
