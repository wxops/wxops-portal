import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner") ?? "";

  let res: Response;
  try {
    res = await fetch(
      `${BACKEND_URL}/api/v1/scaffold/repos?owner=${encodeURIComponent(owner)}`,
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
