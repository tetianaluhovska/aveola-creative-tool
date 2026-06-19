import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchThumb } from "@/lib/drive";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const t = await fetchThumb(id);
    if (!t) return NextResponse.json({ error: "no thumbnail" }, { status: 404 });
    return new Response(t.body, {
      headers: {
        "content-type": t.contentType,
        "cache-control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
