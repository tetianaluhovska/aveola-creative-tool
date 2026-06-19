// server-only: викликати лише з API-роутів / RSC. Ключ ніколи не йде у фронтенд.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

type Block = { type: string; text?: string };

/**
 * runAI — серверний виклик Claude. Повертає зібраний текст відповіді.
 * Модель і версію API задано за CLAUDE.md.
 */
export async function runAI(prompt: string, system?: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY не заданий");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 10000,
      system:
        system ??
        "Ти асистент, що допомагає автоматизувати рутинні задачі. Відповідай стисло і структуровано українською.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { content?: Block[] };
  return (data.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
}
