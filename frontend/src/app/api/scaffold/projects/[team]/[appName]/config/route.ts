import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ team: string; appName: string }> },
) {
  const { team, appName } = await params;
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  let res: Response;
  try {
    res = await fetch(
      `${BACKEND_URL}/api/v1/scaffold/projects/${encodeURIComponent(team)}/${encodeURIComponent(appName)}/config`,
      {
        headers: { Cookie: `wxops_session=${session}` },
        cache: "no-store",
      },
    );
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ team: string; appName: string }> },
) {
  const { team, appName } = await params;
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";
  const body = await request.json();

  let res: Response;
  try {
    res = await fetch(
      `${BACKEND_URL}/api/v1/scaffold/projects/${encodeURIComponent(team)}/${encodeURIComponent(appName)}/config`,
      {
        method: "PUT",
        headers: {
          Cookie: `wxops_session=${session}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
