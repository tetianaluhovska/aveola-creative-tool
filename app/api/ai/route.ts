import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { runAI } from "@/lib/ai";
import { getCreative, listWinners, listElements, type Creative } from "@/lib/notion";

function fmtCreative(c: Creative): string {
  return [
    `Назва: ${c.name}`,
    c.competitor ? `Конкурент: ${c.competitor}` : null,
    c.creoResult ? `Результат (Creo): ${c.creoResult}` : null,
    `Платформа/Формат: ${c.platform || "?"} / ${c.format || "?"}`,
    c.hook ? `Hook: ${c.hook}` : null,
    c.hookVisual ? `Hook Visual: ${c.hookVisual}` : null,
    c.bodyVisual ? `Body Visual: ${c.bodyVisual}` : null,
    c.cta ? `CTA: ${c.cta}` : null,
    c.ctaVisual ? `CTA Visual: ${c.ctaVisual}` : null,
    c.aiDescription ? `AI Description: ${c.aiDescription}` : null,
    c.transcript ? `Transcript: ${c.transcript}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const SYSTEM = `Ти креативний стратег performance-маркетингу дейтинг-додатку Aveola.
Тобі дають: КРЕАТИВ КОНКУРЕНТА, приклади НАШИХ ефективних креативів (з оцінкою Creo Result: Okay/Good/Super) і БІБЛІОТЕКУ перевірених елементів (категорія / опис / чому працює).
Згенеруй РІВНО 3 варіації-брифи для тесту: візьми сильну ідею конкурента й адаптуй під патерни та перевірені елементи, що вже спрацювали в нас.

Формат кожної варіації (markdown, без преамбул):
**Варіація N — <коротка назва>**
- Hook (текст): ...
- Hook Visual: ...
- Body Visual: ...
- CTA: ...
- Чому спрацює: <опора на конкретний патерн наших виграшних>
- 📥 Взято з референсу конкурента: <конкретно що саме — хук / візуал / структура / angle / тон>
- ✅ На основі робочих креативів Aveola: <конкретний патерн/елемент, який додано, ОБОВ'ЯЗКОВО з посиланням на Creo Result (Okay/Good/Super) і crid/назву нашого креатива>
- 🧩 Елементи з бібліотеки: <які саме перевірені елементи використано — назва + категорія з наданого списку>

ГРАУНДИНҐ (критично): будуй варіації ПЕРЕВАЖНО з наданих ПЕРЕВІРЕНИХ ЕЛЕМЕНТІВ і реальних винерів. У пункті «✅ На основі робочих креативів Aveola» посилайся ВИКЛЮЧНО на креативи з наданого списку наших успішних (реальні назви/crid + реальний Creo Result). У пункті «🧩 Елементи з бібліотеки» — лише на елементи з наданого списку. НЕ вигадуй назв, crid, результатів чи елементів, яких немає у наданих даних. Якщо доречного аналога немає — так і напиши.

ВАЖЛИВО про мову: весь текст, який ВИДНО на креативі — Hook (текст), CTA, будь-який on-screen напис — пиши АНГЛІЙСЬКОЮ мовою. Описи візуалу (Hook Visual, Body Visual) і «Чому спрацює» — українською. Стисло й конкретно.`;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { competitorId, input } = (await req.json()) as {
    competitorId?: string;
    input?: string;
  };

  try {
    // 1) Блок конкурента: або з Notion (за id), або з ручного вводу
    let competitorBlock = (input ?? "").trim();
    if (competitorId) {
      const c = await getCreative(competitorId);
      competitorBlock = fmtCreative(c);
    }
    if (!competitorBlock) {
      return NextResponse.json(
        { error: "Потрібен competitorId або input" },
        { status: 400 },
      );
    }

    // 2) Наші виграшні як контекст (м'яка деградація, якщо Notion недоступний)
    let winnersBlock = "(приклади недоступні — генеруй за best practices Aveola)";
    try {
      const winners = await listWinners(12);
      if (winners.length) winnersBlock = winners.map(fmtCreative).join("\n---\n");
    } catch {
      /* Notion ще не підключений */
    }

    // 3) Бібліотека перевірених елементів (третє джерело граундингу)
    let elementsBlock = "";
    try {
      const els = await listElements(60);
      if (els.length) {
        elementsBlock = els
          .map(
            (e) =>
              `• [${e.category || "—"}] ${e.name}${e.description ? ` — ${e.description}` : ""}${e.why ? ` (чому працює: ${e.why})` : ""}`,
          )
          .join("\n");
      }
    } catch {
      /* база елементів недоступна */
    }
    const elementsSection = elementsBlock
      ? `\n\n=== ПЕРЕВІРЕНІ ЕЛЕМЕНТИ (бібліотека Aveola — будуй варіації з них) ===\n${elementsBlock}`
      : "";

    // 4) Генерація
    const prompt = `КРЕАТИВ КОНКУРЕНТА:\n${competitorBlock}\n\n=== НАШІ ЕФЕКТИВНІ КРЕАТИВИ (орієнтир) ===\n${winnersBlock}${elementsSection}\n\nЗгенеруй 3 варіації-брифи.`;
    const output = await runAI(prompt, SYSTEM);

    const userId = (session.user as { id?: string }).id;
    const entry = await prisma.entry.create({
      data: {
        userId: userId!,
        input: competitorBlock,
        output,
        meta: competitorId ? { competitorId } : undefined,
      },
    });

    return NextResponse.json({ entry });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
