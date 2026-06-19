// server-only: Notion REST API. Токен ніколи не йде у фронтенд.

const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function headers() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_TOKEN не заданий");
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "content-type": "application/json",
  };
}

type Prop = {
  type: string;
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  select?: { name: string } | null;
  url?: string | null;
  date?: { start: string } | null;
};

function plain(prop?: Prop): string {
  if (!prop) return "";
  switch (prop.type) {
    case "title":
      return (prop.title ?? []).map((t) => t.plain_text).join("").trim();
    case "rich_text":
      return (prop.rich_text ?? []).map((t) => t.plain_text).join("").trim();
    case "select":
      return prop.select?.name ?? "";
    case "url":
      return prop.url ?? "";
    case "date":
      return prop.date?.start ?? "";
    default:
      return "";
  }
}

export type Creative = {
  id: string;
  name: string;
  competitor?: string;
  platform: string;
  format: string;
  aiDescription: string;
  hook: string;
  hookVisual: string;
  bodyVisual: string;
  cta: string;
  ctaVisual: string;
  transcript: string;
  driveLink: string;
  creoResult?: string;
};

type Page = { id: string; properties: Record<string, Prop> };

function mapCreative(page: Page): Creative {
  const p = page.properties;
  return {
    id: page.id,
    name: plain(p["Creative Name"]),
    competitor: plain(p["Competitor"]) || undefined,
    platform: plain(p["Platform"]),
    format: plain(p["Format"]),
    aiDescription: plain(p["AI Description"]),
    hook: plain(p["Hook"]),
    hookVisual: plain(p["Hook Visual"]),
    bodyVisual: plain(p["Body Visual"]),
    cta: plain(p["CTA"]),
    ctaVisual: plain(p["CTA Visual"]),
    transcript: plain(p["Transcript"]),
    driveLink: plain(p["Drive Link"]),
    creoResult: plain(p["📈 Creo Result"]) || undefined,
  };
}

async function queryDb(dbId: string, body: object = {}): Promise<Page[]> {
  const res = await fetch(`${API}/databases/${dbId}/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { results: Page[] };
  return data.results ?? [];
}

export async function listCompetitorCreatives(limit = 50): Promise<Creative[]> {
  const id = process.env.NOTION_DB_COMPETITORS;
  if (!id) throw new Error("NOTION_DB_COMPETITORS не заданий");
  const rows = await queryDb(id, { page_size: limit });
  return rows.map(mapCreative).filter((c) => c.name);
}

export async function getCreative(pageId: string): Promise<Creative> {
  const res = await fetch(`${API}/pages/${pageId}`, { headers: headers() });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return mapCreative((await res.json()) as Page);
}

/** Наші ефективні: «📈 Creo Result» не порожнє (Okay/Good/Super). */
export async function listWinners(limit = 6): Promise<Creative[]> {
  const id = process.env.NOTION_DB_OURS;
  if (!id) throw new Error("NOTION_DB_OURS не заданий");
  const rows = await queryDb(id, {
    page_size: limit,
    filter: { property: "📈 Creo Result", select: { is_not_empty: true } },
  });
  return rows.map(mapCreative);
}
