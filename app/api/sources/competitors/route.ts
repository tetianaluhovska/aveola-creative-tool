import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listCompetitorCreatives } from "@/lib/notion";

// Drive link → наш проксі-прев'ю (сервер тягне через service account, файл лишається приватним)
function driveThumb(url: string): string | null {
  if (!url) return null;
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? `/api/thumb?id=${m[1]}` : null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const items = await listCompetitorCreatives(60);
    return NextResponse.json({
      items: items.map((c) => ({
        id: c.id,
        name: c.name,
        competitor: c.competitor,
        platform: c.platform,
        format: c.format,
        driveLink: c.driveLink,
        thumb: driveThumb(c.driveLink),
      })),
    });
  } catch (e) {
    // Notion ще не підключений — деградуємо м'яко
    return NextResponse.json({ items: [], error: (e as Error).message });
  }
}
