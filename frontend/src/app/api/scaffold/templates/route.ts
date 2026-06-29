import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/api/v1/scaffold/templates`, {
      headers: { Cookie: `wxops_session=${session}` },
      next: { revalidate: 300 },
    });
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }

  const data = await res.json();
  const response = NextResponse.json(data, { status: res.status });
  response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
  return response;
}
