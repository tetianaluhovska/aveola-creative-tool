import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listCompetitorCreatives } from "@/lib/notion";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const items = await listCompetitorCreatives(50);
    // повертаємо лише потрібне для дропдауна
    return NextResponse.json({
      items: items.map((c) => ({
        id: c.id,
        name: c.name,
        competitor: c.competitor,
        platform: c.platform,
        format: c.format,
      })),
    });
  } catch (e) {
    // Notion ще не підключений — деградуємо м'яко, UI лишає ручний ввід
    return NextResponse.json({ items: [], error: (e as Error).message });
  }
}
