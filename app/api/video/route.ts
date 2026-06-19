import { NextResponse } from "next/server";
import { auth } from "@/auth";

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

  const videoPrompt =
    "Vertical 9:16 short-form UGC-style dating app video ad, ~8 seconds. " +
    "No spoken dialogue; soft ambient background music only. " +
    "All on-screen text and captions in ENGLISH. Authentic, mobile-shot, cinematic feel.\n\nBrief:\n" +
    prompt.slice(0, 1500);

  try {
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
