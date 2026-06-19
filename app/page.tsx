"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession, signIn, signOut } from "next-auth/react";

type Entry = {
  id: string;
  input: string;
  output: string;
  createdAt: string;
};

type CompetitorOption = {
  id: string;
  name: string;
  competitor?: string;
  platform?: string;
  format?: string;
  thumb?: string | null;
  driveLink?: string;
};

export default function Workspace() {
  const { data: session, status } = useSession();
  const user = session?.user ?? null;

  const [competitors, setCompetitors] = useState<CompetitorOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Entry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [videoState, setVideoState] = useState<"idle" | "working" | "ready" | "error">("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoErr, setVideoErr] = useState<string | null>(null);
  const videoRunRef = useRef(0);

  function resetVideo() {
    videoRunRef.current++; // скасовує будь-який активний полінг
    setVideoState("idle");
    setVideoUrl(null);
    setVideoErr(null);
  }

  async function genVideo() {
    if (!result || videoState === "working") return;
    const myRun = ++videoRunRef.current;
    setVideoState("working");
    setVideoUrl(null);
    setVideoErr(null);
    try {
      const r = await fetch("/api/video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: result }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || "Не вдалося стартувати генерацію.");
      const op = data.op as string;
      for (let i = 0; i < 45; i++) {
        await new Promise((res) => setTimeout(res, 8000));
        if (videoRunRef.current !== myRun) return; // скасовано новим запуском
        const pr = await fetch("/api/video?op=" + encodeURIComponent(op));
        const pd = await pr.json();
        if (pd.error) throw new Error(pd.error);
        if (pd.done && pd.ready) {
          setVideoUrl("/api/video?file=1&op=" + encodeURIComponent(op));
          setVideoState("ready");
          return;
        }
      }
      throw new Error("Перевищено час очікування генерації відео.");
    } catch (e) {
      if (videoRunRef.current !== myRun) return;
      setVideoErr((e as Error).message);
      setVideoState("error");
    }
  }

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/entries");
      if (!r.ok) return;
      const data = await r.json();
      setHistory(data.entries ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadCompetitors = useCallback(async () => {
    try {
      const r = await fetch("/api/sources/competitors");
      if (!r.ok) return;
      const data = await r.json();
      setCompetitors(data.items ?? []);
    } catch {
      /* Notion ще не підключений — лишається ручний ввід */
    }
  }, []);

  // після входу — підтягнути історію з БД (відновлення прогресу) + список конкурентів
  useEffect(() => {
    if (status === "authenticated") {
      loadHistory();
      loadCompetitors();
    }
    if (status === "unauthenticated") {
      setHistory([]);
      setResult(null);
      setInput("");
      setSelectedId("");
      setActiveId(null);
    }
  }, [status, loadHistory, loadCompetitors]);

  async function run() {
    if ((!input.trim() && !selectedId) || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setActiveId(null);
    resetVideo();
    try {
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selectedId ? { competitorId: selectedId } : { input }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const { entry } = (await r.json()) as { entry: Entry };
      setResult(entry.output);
      setActiveId(entry.id);
      setHistory((h) => [entry, ...h]);
    } catch {
      setError("Не вдалося обробити запит. Перевір ключ AI і спробуй ще раз.");
    } finally {
      setRunning(false);
    }
  }

  function openRun(item: Entry) {
    setInput(item.input);
    setResult(item.output);
    setActiveId(item.id);
    setError(null);
    resetVideo();
  }
  function newRun() {
    setInput("");
    setSelectedId("");
    setResult(null);
    setActiveId(null);
    setError(null);
    resetVideo();
  }

  const title = (text: string) => text.slice(0, 42) + (text.length > 42 ? "…" : "");
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("uk-UA");
  };

  return (
    <div className="ws-app">
      <style>{CSS}</style>

      {/* ── Top bar ───────────────────────────── */}
      <header className="ws-bar">
        <div className="ws-brand">
          <span className="ws-mark" aria-hidden>◑</span>
          <span className="ws-brand-name">Aveola</span>
          <span className="ws-brand-sub">Creative Variations</span>
        </div>
        {user && (
          <div className="ws-user">
            <span className="ws-avatar" aria-hidden>
              {(user.name ?? user.email ?? "?")[0]}
            </span>
            <span className="ws-user-email">{user.email}</span>
            <button className="ws-btn-ghost" onClick={() => signOut()}>Вийти</button>
          </div>
        )}
      </header>

      {/* ── Signed-out ────────────────────────── */}
      {!user ? (
        <main className="ws-gate">
          <p className="ws-eyebrow">доступ</p>
          <h1 className="ws-gate-title">Увійди, щоб почати</h1>
          <p className="ws-gate-sub">
            Інструмент збереже твої запуски — повернешся й продовжиш з того ж місця.
          </p>
          <button className="ws-google" onClick={() => signIn("google")} disabled={status === "loading"}>
            <GoogleG /> Увійти через Google
          </button>
        </main>
      ) : (
        /* ── Workspace ───────────────────────── */
        <main className="ws-grid">
          {/* Input */}
          <section className="ws-panel">
            <div className="ws-panel-head">
              <p className="ws-eyebrow">ввід</p>
              <button className="ws-btn-ghost ws-sm" onClick={newRun}>Новий запуск</button>
            </div>
            <h2 className="ws-panel-title">Обери креатив конкурента</h2>
            <p className="ws-panel-hint">
              {competitors.length > 0
                ? "Клікни візуал — Claude згенерує варіації на основі наших виграшних креативів."
                : "Підключи Notion, щоб підтягнути візуали конкурентів. Поки доступний ручний ввід нижче."}
            </p>
            {competitors.length > 0 && (
              <div className="ws-pick">
                {competitors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={"ws-card" + (selectedId === c.id ? " is-active" : "")}
                    onClick={() => setSelectedId((id) => (id === c.id ? "" : c.id))}
                    title={[c.competitor, c.name].filter(Boolean).join(" · ")}
                  >
                    <span className="ws-card-thumb">
                      <span className="ws-card-noimg">
                        {c.format || "креатив"}
                        <em>прев&apos;ю недоступне</em>
                      </span>
                      {c.thumb && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="ws-card-img"
                          src={c.thumb}
                          alt={c.name}
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      )}
                      {c.competitor && <span className="ws-card-badge">{c.competitor}</span>}
                    </span>
                    <span className="ws-card-name">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              className="ws-input ws-input-sm"
              placeholder={
                selectedId
                  ? "Креатив обрано. Можеш додати нотатки (необов'язково)."
                  : "…або встав опис креатива конкурента вручну: hook, меседж, візуал, CTA."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="ws-actions">
              <span className="ws-counter">
                {selectedId ? "обрано з Notion" : `${input.length} символів`}
              </span>
              <button
                className="ws-run"
                onClick={run}
                disabled={running || (!input.trim() && !selectedId)}
              >
                {running ? <><span className="ws-spin" /> Обробка…</> : "Запустити AI"}
              </button>
            </div>
          </section>

          {/* Result */}
          <section className="ws-panel">
            <div className="ws-panel-head">
              <p className="ws-eyebrow">результат</p>
            </div>

            {running && (
              <div className="ws-state">
                <div className="ws-skeleton" />
                <div className="ws-skeleton ws-w80" />
                <div className="ws-skeleton ws-w60" />
                <p className="ws-state-note">AI працює над відповіддю…</p>
              </div>
            )}

            {!running && error && (
              <div className="ws-error">
                <strong>Помилка обробки.</strong>
                <span>{error}</span>
              </div>
            )}

            {!running && !error && !result && (
              <div className="ws-empty">
                <span className="ws-empty-mark" aria-hidden>↳</span>
                <p>Тут з&apos;явиться відповідь AI.<br />Введи дані зліва й натисни «Запустити AI».</p>
              </div>
            )}

            {!running && !error && result && (
              <div className="ws-output">{result}</div>
            )}

            {!running && !error && result && (
              <div className="ws-video">
                {videoState !== "ready" && (
                  <button className="ws-vbtn" onClick={genVideo} disabled={videoState === "working"}>
                    {videoState === "working" ? (
                      <><span className="ws-spin" /> Генерую відео Veo (1–3 хв)…</>
                    ) : (
                      "🎬 Згенерувати відео (Veo)"
                    )}
                  </button>
                )}
                {videoState === "error" && <p className="ws-verr">{videoErr}</p>}
                {videoState === "ready" && videoUrl && (
                  <video className="ws-player" src={videoUrl} controls autoPlay loop playsInline />
                )}
              </div>
            )}
          </section>

          {/* History */}
          <aside className="ws-history">
            <p className="ws-eyebrow">запуски</p>
            {history.length === 0 ? (
              <p className="ws-history-empty">Поки порожньо.</p>
            ) : (
              <ul className="ws-history-list">
                {history.map((item) => (
                  <li key={item.id}>
                    <button
                      className={"ws-history-item" + (activeId === item.id ? " is-active" : "")}
                      onClick={() => openRun(item)}
                    >
                      <span className="ws-history-title">{title(item.input)}</span>
                      <span className="ws-history-time">{when(item.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </main>
      )}
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.2 13.2 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7c4.3-4 6.8-9.9 6.8-17.4z" />
      <path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.2-8.5 2.2-6.4 0-11.8-3.7-13.6-9l-7.9 6.1C6.4 42.6 14.6 48 24 48z" />
    </svg>
  );
}

const CSS = `
.ws-app{
  --bg:#EEF1F5; --surface:#FFFFFF; --ink:#15181F; --muted:#6A7280;
  --line:#DDE2EA; --accent:#3B43E0; --accent-soft:#EAEBFD; --danger:#C0392B;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  min-height:100vh; box-sizing:border-box; color:var(--ink);
  font-family:var(--sans); background:var(--bg);
  background-image:radial-gradient(var(--line) 1px, transparent 1px);
  background-size:22px 22px; padding:18px;
}
.ws-app *{box-sizing:border-box;}

.ws-bar{display:flex;justify-content:space-between;align-items:center;
  background:var(--surface);border:1px solid var(--line);border-radius:14px;
  padding:12px 16px;margin-bottom:18px;}
.ws-brand{display:flex;align-items:baseline;gap:8px;}
.ws-mark{color:var(--accent);font-size:18px;transform:translateY(2px);}
.ws-brand-name{font-weight:700;letter-spacing:-0.02em;font-size:17px;}
.ws-brand-sub{font-family:var(--mono);font-size:11px;letter-spacing:0.12em;
  text-transform:uppercase;color:var(--muted);}
.ws-user{display:flex;align-items:center;gap:10px;}
.ws-avatar{width:28px;height:28px;border-radius:50%;background:var(--accent);
  color:#fff;display:grid;place-items:center;font-weight:600;font-size:13px;}
.ws-user-email{color:var(--muted);font-size:13px;}

.ws-eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:0.16em;
  text-transform:uppercase;color:var(--muted);margin:0 0 10px;}

/* gate */
.ws-gate{max-width:440px;margin:8vh auto 0;background:var(--surface);
  border:1px solid var(--line);border-radius:16px;padding:36px 32px;text-align:left;}
.ws-gate-title{font-size:26px;letter-spacing:-0.03em;margin:0 0 8px;}
.ws-gate-sub{color:var(--muted);font-size:14px;line-height:1.5;margin:0 0 24px;}
.ws-google{display:inline-flex;align-items:center;gap:10px;background:#fff;
  border:1px solid var(--line);border-radius:10px;padding:11px 18px;font-size:14px;
  font-weight:500;cursor:pointer;transition:border-color .15s,box-shadow .15s;}
.ws-google:hover{border-color:#c4cad6;box-shadow:0 1px 0 rgba(0,0,0,.04);}
.ws-google:disabled{opacity:.5;cursor:not-allowed;}

/* grid */
.ws-grid{display:grid;grid-template-columns:1.25fr 1fr;grid-template-rows:auto;
  gap:16px;align-items:start;}
.ws-history{grid-column:1 / -1;}

.ws-panel{background:var(--surface);border:1px solid var(--line);border-radius:16px;
  padding:18px 18px 16px;min-height:280px;display:flex;flex-direction:column;}
.ws-panel-head{display:flex;justify-content:space-between;align-items:center;}
.ws-panel-title{font-size:18px;letter-spacing:-0.02em;margin:2px 0 4px;}
.ws-panel-hint{color:var(--muted);font-size:13px;margin:0 0 14px;}

.ws-input{flex:1;width:100%;min-height:150px;resize:vertical;border:1px solid var(--line);
  border-radius:10px;padding:12px 14px;font:inherit;font-size:14px;line-height:1.5;
  background:#FBFCFE;color:var(--ink);outline:none;transition:border-color .15s;}
.ws-input:focus{border-color:var(--accent);}

.ws-input-sm{min-height:60px;flex:none;}

.ws-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px;
  max-height:340px;overflow:auto;padding:2px;margin-bottom:12px;}
.ws-card{padding:0;border:1px solid var(--line);border-radius:12px;background:var(--surface);
  cursor:pointer;overflow:hidden;display:flex;flex-direction:column;text-align:left;
  transition:border-color .15s,box-shadow .15s;}
.ws-card:hover{border-color:#c4cad6;}
.ws-card.is-active{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft);}
.ws-card-thumb{position:relative;aspect-ratio:1/1;background:#F1F3F8;overflow:hidden;}
.ws-card-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.ws-card-noimg{position:absolute;inset:0;display:flex;flex-direction:column;gap:3px;
  align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;
  color:var(--muted);text-transform:uppercase;}
.ws-card-noimg em{font-style:normal;font-size:9px;opacity:.65;text-transform:none;}
.ws-card-badge{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.62);color:#fff;
  font-size:10px;padding:2px 7px;border-radius:6px;font-weight:500;}
.ws-card-name{font-size:11px;line-height:1.3;padding:7px 8px;color:var(--ink);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}

.ws-actions{display:flex;justify-content:space-between;align-items:center;margin-top:14px;}
.ws-counter{font-family:var(--mono);font-size:11px;color:var(--muted);}
.ws-run{background:var(--accent);color:#fff;border:none;border-radius:10px;
  padding:11px 20px;font-size:14px;font-weight:600;cursor:pointer;
  display:inline-flex;align-items:center;gap:9px;transition:filter .15s,opacity .15s;}
.ws-run:hover:not(:disabled){filter:brightness(1.08);}
.ws-run:disabled{opacity:.5;cursor:not-allowed;}

.ws-btn-ghost{background:transparent;border:1px solid var(--line);border-radius:9px;
  padding:8px 13px;font-size:13px;color:var(--ink);cursor:pointer;transition:border-color .15s;}
.ws-btn-ghost:hover{border-color:#c4cad6;}
.ws-sm{padding:5px 11px;font-size:12px;}

/* result states */
.ws-state{display:flex;flex-direction:column;gap:10px;padding-top:6px;}
.ws-skeleton{height:14px;border-radius:6px;background:linear-gradient(90deg,#eef0f4,#e2e6ee,#eef0f4);
  background-size:200% 100%;animation:ws-sh 1.2s infinite;}
.ws-w80{width:80%;} .ws-w60{width:60%;}
@keyframes ws-sh{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
.ws-state-note{color:var(--muted);font-size:13px;margin:6px 0 0;}

.ws-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;color:var(--muted);font-size:13px;line-height:1.5;gap:8px;}
.ws-empty-mark{font-size:26px;color:var(--line);}

.ws-error{border:1px solid #f0c9c4;background:#fdf3f1;color:var(--danger);
  border-radius:10px;padding:14px;font-size:13px;display:flex;flex-direction:column;gap:4px;}

.ws-output{white-space:pre-wrap;font-size:14px;line-height:1.6;color:var(--ink);
  background:#FBFCFE;border:1px solid var(--line);border-radius:10px;padding:14px;flex:1;}

.ws-video{margin-top:14px;display:flex;flex-direction:column;gap:10px;}
.ws-vbtn{align-self:flex-start;background:var(--ink);color:#fff;border:none;border-radius:10px;
  padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;
  align-items:center;gap:8px;transition:opacity .15s;}
.ws-vbtn:disabled{opacity:.6;cursor:not-allowed;}
.ws-verr{color:var(--danger);font-size:12px;margin:0;}
.ws-player{width:100%;max-width:300px;border-radius:12px;border:1px solid var(--line);align-self:flex-start;}

/* history */
.ws-history-list{list-style:none;margin:0;padding:0;display:grid;
  grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;}
.ws-history-empty{color:var(--muted);font-size:13px;}
.ws-history-item{width:100%;text-align:left;background:var(--surface);
  border:1px solid var(--line);border-left:3px solid var(--line);border-radius:10px;
  padding:11px 13px;cursor:pointer;display:flex;flex-direction:column;gap:4px;
  transition:border-color .15s,background .15s;}
.ws-history-item:hover{border-color:#c4cad6;}
.ws-history-item.is-active{border-left-color:var(--accent);background:var(--accent-soft);}
.ws-history-title{font-size:13px;font-weight:500;line-height:1.35;}
.ws-history-time{font-family:var(--mono);font-size:10px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--muted);}

.ws-spin{width:13px;height:13px;border:2px solid rgba(255,255,255,.4);
  border-top-color:#fff;border-radius:50%;animation:ws-rot .7s linear infinite;}
@keyframes ws-rot{to{transform:rotate(360deg);}}

@media (max-width:820px){
  .ws-grid{grid-template-columns:1fr;}
  .ws-user-email{display:none;}
}
@media (prefers-reduced-motion:reduce){
  .ws-skeleton,.ws-spin{animation:none;}
}
`;
