import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runAI } from "@/lib/ai";

const SAFE_SYSTEM = `You turn a marketing creative brief into ONE concise video prompt for Google Veo — an ad for a social video-chat / meet-new-people mobile app (Aveola).
Output ONLY the video prompt (3-5 sentences), nothing else.
Stay FAITHFUL to the brief: keep the same setting, character(s), mood and the key on-screen captions. Translate captions to short punchy ENGLISH and place them as bold on-screen text. You may show the phone and app UI (chat list, "Online now", an incoming message, profile cards).
Make it vertical 9:16, ~8 seconds, authentic UGC mobile-shot feel.
KEEP IT ADVERTISING-SAFE: no nudity, nothing sexual or suggestive, no explicit romantic/dating solicitation. Reframe risky phrasing (e.g. "real girls waiting for you") into brand-safe equivalents ("new people to chat with", "new messages waiting"). Friendly, upbeat, advertising-safe.`;

const BASE = "https://generativelanguage.googleapis.com/v1beta";
// Veo 2 — відео без аудіо, тож не впирається в аудіо-фільтр Veo 3 (надійніше для демо).
const MODEL = process.env.GEMINI_VEO_MODEL || "veo-2.0-generate-001";

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY не заданий");
  return k;
}

// Витягнути URL відео з відповіді операції (стійко до різних форматів Veo)
function findVideoUri(op: unknown): string | null {
  let found: string | null = null;
  JSON.stringify(op ?? {}, (k, v) => {
    if (k === "uri" && typeof v === "string" && !found) found = v;
    return v;
  });
  return found;
}

// Старт генерації
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { prompt } = (await req.json()) as { prompt?: string };
  if (!prompt?.trim()) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  try {
    // 1) Зробити з брифу нейтральний, policy-safe промт (Claude), щоб Veo не різав по контенту
    let scene: string;
    try {
      scene = await runAI(`Brief:\n${prompt.slice(0, 1500)}`, SAFE_SYSTEM);
    } catch {
      scene = "A friendly young person smiles while using a smartphone app at a sunny kitchen table. On-screen English caption: Try it now.";
    }
    const videoPrompt =
      scene +
      " Vertical 9:16, about 8 seconds, authentic mobile-shot UGC look, no spoken dialogue, soft ambient music only.";

    const res = await fetch(`${BASE}/models/${MODEL}:predictLongRunning?key=${key()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: videoPrompt }],
        parameters: { aspectRatio: "9:16" },
      }),
    });
    if (!res.ok) throw new Error(`Veo ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { name?: string };
    if (!data.name) throw new Error("Veo не повернув operation name");
    return NextResponse.json({ op: data.name });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// GET ?op=NAME           → статус { done, ready, error }
// GET ?op=NAME&file=1    → стрім готового mp4
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const op = url.searchParams.get("op");
  const wantFile = url.searchParams.get("file") === "1";
  if (!op) return NextResponse.json({ error: "op is required" }, { status: 400 });

  try {
    const res = await fetch(`${BASE}/${op}?key=${key()}`);
    if (!res.ok) throw new Error(`Veo poll ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      done?: boolean;
      error?: { message?: string };
      response?: unknown;
    };

    if (!data.done) return NextResponse.json({ done: false });
    if (data.error) return NextResponse.json({ done: true, error: data.error.message });

    const uri = findVideoUri(data.response);
    if (!uri) {
      const resp = data.response as {
        generateVideoResponse?: { raiMediaFilteredReasons?: string[] };
      };
      const rai = resp?.generateVideoResponse?.raiMediaFilteredReasons?.[0];
      return NextResponse.json({
        done: true,
        error: rai || "Відео не згенеровано (відфільтровано модерацією). Спробуй інший креатив.",
      });
    }

    if (!wantFile) return NextResponse.json({ done: true, ready: true });

    // стрімимо mp4 через сервер (ключ не світиться в клієнті)
    const sep = uri.includes("?") ? "&" : "?";
    const file = await fetch(`${uri}${sep}key=${key()}`);
    if (!file.ok || !file.body) throw new Error(`download ${file.status}`);
    return new Response(file.body, {
      headers: {
        "content-type": file.headers.get("content-type") || "video/mp4",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
