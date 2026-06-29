import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = cookieStore.get("wxops_session")?.value ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "all";
  const page = request.nextUrl.searchParams.get("page") ?? "1";
  const limit = request.nextUrl.searchParams.get("limit") ?? "20";

  const params = new URLSearchParams({ state, page, limit });

  let res: Response;
  try {
    res = await fetch(
      `${BACKEND_URL}/api/v1/catalog/activity?${params.toString()}`,
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
