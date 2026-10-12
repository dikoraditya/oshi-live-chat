"use client";

import { useEffect, useRef, useState } from "react";

import { Asr } from "@/lib/asr";

type Reply = { jp: string; romaji: string; en: string; tone: string };
type Card = {
  id: string;
  jp: string;
  status: "loading" | "done" | "error";
  heardEn?: string;
  replies?: Reply[];
  error?: string;
};

function isReply(v: unknown): v is Reply {
  if (!v || typeof v !== "object") return false;
  return (
    "jp" in v &&
    typeof v.jp === "string" &&
    "romaji" in v &&
    typeof v.romaji === "string" &&
    "en" in v &&
    typeof v.en === "string" &&
    "tone" in v &&
    typeof v.tone === "string"
  );
}

function isAssist(v: unknown): v is { heard_en: string; replies: Reply[] } {
  if (!v || typeof v !== "object") return false;
  if (!("heard_en" in v) || typeof v.heard_en !== "string") return false;
  if (!("replies" in v) || !Array.isArray(v.replies)) return false;
  return v.replies.every(isReply);
}

function errorMessage(v: unknown, fallback: string): string {
  if (v && typeof v === "object" && "error" in v && typeof v.error === "string") return v.error;
  return fallback;
}

export default function Page() {
  const asrRef = useRef<Asr | null>(null);
  const historyRef = useRef<string[]>([]);

  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [asrError, setAsrError] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [nickname, setNickname] = useState("");
  const [manual, setManual] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const asr = new Asr("ja-JP");
    asrRef.current = asr;
    setSupported(asr.supported);
    setNickname(localStorage.getItem("talk-live:nick") ?? "");
    return () => asr.stop();
  }, []);

  useEffect(() => {
    localStorage.setItem("talk-live:nick", nickname);
  }, [nickname]);

  function updateCard(id: string, patch: (card: Card) => Card) {
    setCards((prev) => prev.map((card) => (card.id === id ? patch(card) : card)));
  }

  async function runAssist(id: string, jp: string) {
    try {
      const res = await fetch("/api/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jp,
          history: historyRef.current.slice(0, -1).slice(-6),
          nickname: nickname.trim() || undefined,
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = errorMessage(data, `Error ${res.status}`);
        updateCard(id, (card) => ({ ...card, status: "error", error: message }));
        return;
      }
      if (!isAssist(data)) {
        updateCard(id, (card) => ({ ...card, status: "error", error: "Unexpected response shape." }));
        return;
      }
      updateCard(id, (card) => ({ ...card, status: "done", heardEn: data.heard_en, replies: data.replies }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error.";
      updateCard(id, (card) => ({ ...card, status: "error", error: message }));
    }
  }

  function handleLine(raw: string) {
    const jp = raw.trim();
    if (!jp) return;
    const id = crypto.randomUUID();
    historyRef.current = [...historyRef.current, jp].slice(-12);
    setCards((prev) => [{ id, jp, status: "loading" }, ...prev]);
    void runAssist(id, jp);
  }

  function toggleMic() {
    const asr = asrRef.current;
    if (!asr) return;
    if (listening) {
      asr.stop();
      setListening(false);
      setInterim("");
      return;
    }
    setAsrError(null);
    asr.start({
      onInterim: setInterim,
      onFinal: (text) => {
        setInterim("");
        handleLine(text);
      },
      onError: (message) => setAsrError(message),
    });
    setListening(true);
  }

  function sendManual() {
    const text = manual.trim();
    if (!text) return;
    handleLine(text);
    setManual("");
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <main className="app">
      <div className="topbar">
        <div className="brand">
          Talk<span className="dot">·</span>Live
        </div>
        <div className="spacer" />
        <input
          className="nick"
          placeholder="your fan name"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <button className={`mic${listening ? " on" : ""}`} onClick={toggleMic}>
          {listening ? "◼ Stop" : "● Listen"}
        </button>
      </div>

      {!supported && (
        <div className="notice">
          This browser has no speech recognition. Use <b>Chrome</b> for live mic capture, or type the
          idol&apos;s line below to translate it.
        </div>
      )}
      {asrError && <div className="notice err">Mic: {asrError}</div>}

      <div className="live">
        {interim ? (
          <span className="interim">{interim}</span>
        ) : (
          <span className="placeholder">
            {listening ? "Listening… speak or wait for the idol." : "Press Listen, or type a line below."}
          </span>
        )}
      </div>

      <div className="manual">
        <input
          placeholder="type / paste Japanese…"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendManual();
          }}
        />
        <button onClick={sendManual}>Translate</button>
      </div>

      <div className="feed">
        {cards.map((card) => (
          <article className="card" key={card.id}>
            <div className="jp">{card.jp}</div>
            {card.heardEn && <div className="en">{card.heardEn}</div>}
            {card.status === "loading" && <div className="status">translating + drafting replies…</div>}
            {card.status === "error" && <div className="status err">{card.error}</div>}
            {card.replies && (
              <div className="replies">
                {card.replies.map((reply, i) => {
                  const key = `${card.id}:${i}`;
                  return (
                    <button className="reply" key={key} onClick={() => copy(key, reply.jp)}>
                      <div className="reply-jp">
                        {reply.jp}
                        {copiedKey === key && <span className="copied">copied</span>}
                      </div>
                      <div className="reply-romaji">{reply.romaji}</div>
                      <div className="reply-en">{reply.en}</div>
                      <span className="tone">{reply.tone}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="hint">
        Tap a reply to copy it · open-mic prototype — keep the iPad speaker audible to this device.
      </div>
    </main>
  );
}
