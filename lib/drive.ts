// server-only: проксі прев'ю з Google Drive через service account (файли лишаються приватними).
import crypto from "node:crypto";

type SA = { client_email: string; private_key: string };
let cached: { token: string; exp: number } | null = null;

function loadSA(): SA {
  const b64 = process.env.GOOGLE_SA_KEY_B64;
  if (!b64) throw new Error("GOOGLE_SA_KEY_B64 не заданий");
  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  if (!json.client_email || !json.private_key) throw new Error("Невалідний service account JSON");
  return { client_email: json.client_email, private_key: json.private_key };
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;

  const sa = loadSA();
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signed = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(signed).sign(sa.private_key);
  const jwt = `${signed}.${b64url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return cached.token;
}

/** Прев'ю файлу Drive (зображення або постер відео). null — якщо прев'ю немає. */
export async function fetchThumb(
  fileId: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | null> {
  const token = await getToken();
  const auth = { Authorization: `Bearer ${token}` };

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink,mimeType&supportsAllDrives=true`,
    { headers: auth },
  );
  if (!metaRes.ok) throw new Error(`drive meta ${metaRes.status}: ${await metaRes.text()}`);
  const meta = (await metaRes.json()) as { thumbnailLink?: string; mimeType?: string };

  // 1) thumbnailLink (працює і для відео, і для зображень) — піднімаємо роздільність
  if (meta.thumbnailLink) {
    const link = meta.thumbnailLink.replace(/=s\d+$/, "=s640");
    const r = await fetch(link, { headers: auth });
    if (r.ok && r.body) {
      return { body: r.body, contentType: r.headers.get("content-type") || "image/jpeg" };
    }
  }
  // 2) fallback для зображень — пряме медіа
  if ((meta.mimeType || "").startsWith("image/")) {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
      { headers: auth },
    );
    if (r.ok && r.body) {
      return { body: r.body, contentType: r.headers.get("content-type") || meta.mimeType! };
    }
  }
  return null;
}
