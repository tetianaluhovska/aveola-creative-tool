import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runAI } from "@/lib/ai";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { input } = (await req.json()) as { input?: string };
  if (!input || !input.trim()) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  // 🔌 ВОРКШОП: тут зібрати промт із даних Notion
  //   (креатив конкурента з NOTION_DB_COMPETITORS + наші виграшні з NOTION_DB_OURS,
  //    фільтр "📈 Creo Result" не порожнє) і покликати runAI зі спеціальним system-промтом,
  //    щоб згенерувати варіації-брифи. Поки — базова обробка вводу, щоб демо працювало.
  const output = await runAI(input);

  const userId = (session.user as { id?: string }).id;
  const entry = await prisma.entry.create({
    data: { userId: userId!, input, output },
  });

  return NextResponse.json({ entry });
}
