import { useCallback, useEffect, useRef, useState } from "react";
import type { AppView, Note } from "../shared";
import { RecordCard } from "./RecordCard";
import { CognitionPanel } from "./CognitionPanel";
import { SettingsModal } from "./SettingsModal";

export function App() {
  const [data, setData] = useState<AppView | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [raw, setRaw] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Note[] | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [panel, setPanel] = useState(true);
  const [settings, setSettings] = useState(false);
  const [mode, setMode] = useState<"note" | "discussion">("note");
  const [pro, setPro] = useState(false);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(0);
  const refreshRevision = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    const next = await window.uki.view();
    if (revision === refreshRevision.current) setData(next);
  }, []);
  useEffect(() => {
    if (!window.uki) {
      setError("请通过 Windows 桌面应用打开 ChatNoteUki");
      return;
    }
    void refresh().catch((e) => setError(String(e.message)));
    return window.uki.onChanged(() => {
      void refresh().catch((e) => setError(String(e.message)));
    });
  }, [refresh]);
  useEffect(() => {
    let active = true;
    if (!query.trim()) {
      setMatches(null);
      return;
    }
    const timer = setTimeout(() => {
      void window.uki
        .search(query)
        .then((result) => {
          if (active) setMatches(result);
        })
        .catch((e) => setError(String(e.message)));
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, data?.notes]);
  const action = useCallback(
    (fn: () => Promise<unknown>) => {
      setWorking((n) => n + 1);
      setError("");
      void fn()
        .then(refresh)
        .catch((e) =>
          setError(
            String(e.message).replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            ),
          ),
        )
        .finally(() => setWorking((n) => n - 1));
    },
    [refresh],
  );
  const capture = async () => {
    if (!raw.trim() || saving) return;
    setSaving(true);
    setError("");
    const submitted = raw;
    try {
      const id = await window.uki.capture({
        raw: submitted,
        threadId: selected,
        mode,
        model:
          mode === "discussion" && pro ? "deepseek-v4-pro" : "deepseek-flash",
      });
      setRaw((current) => (current === submitted ? "" : current));
      setOpenNote(id);
      setPro(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };
  const showEvidence = (id: string) => {
    setSelected(null);
    setPendingOnly(false);
    setQuery("");
    setOpenNote(id);
    requestAnimationFrame(() =>
      document
        .getElementById(`note-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };
  if (!data)
    return (
      <main className="loading">
        <h1>ChatNoteUki</h1>
        <p>{error || "正在打开你的思考空间…"}</p>
      </main>
    );
  const thread = data.threads.find((t) => t.id === selected);
  const notes = (matches ?? data.notes)
    .filter(
      (n) =>
        (!selected || n.threadId === selected) &&
        (!pendingOnly || n.status !== "done"),
    )
    .slice()
    .reverse();
  const title = query
    ? "查找过去的想法"
    : pendingOnly
      ? "等待处理的记录"
      : (thread?.title ?? "想法，从这里开始");
  return (
    <div className={`app-shell ${panel ? "" : "panel-hidden"}`}>
      <nav className="sidebar" aria-label="思考线程">
        <div className="brand">
          <span className="brand-mark">思</span>
          <strong>ChatNoteUki</strong>
        </div>
        <button
          className="new-thought"
          onClick={() => {
            setSelected(null);
            setPendingOnly(false);
            setQuery("");
            setMode("note");
            document.getElementById("capture")?.focus();
          }}
        >
          写下新想法
        </button>
        <button
          className={`nav-item ${!selected && !pendingOnly ? "active" : ""}`}
          onClick={() => {
            setSelected(null);
            setPendingOnly(false);
            setMode("note");
          }}
        >
          全部记录 <span>{data.notes.length}</span>
        </button>
        <button
          className={`nav-item ${pendingOnly ? "active" : ""}`}
          onClick={() => {
            setSelected(null);
            setPendingOnly(true);
            setMode("note");
          }}
        >
          等待处理{" "}
          <span>{data.notes.filter((n) => n.status !== "done").length}</span>
        </button>
        <div className="threads-label">持续思考的问题</div>
        <div className="thread-list">
          {data.threads
            .slice()
            .reverse()
            .map((t) => (
              <button
                title={t.title}
                key={t.id}
                className={`thread-item ${selected === t.id ? "active" : ""}`}
                onClick={() => {
                  setSelected(t.id);
                  setPendingOnly(false);
                  setQuery("");
                }}
              >
                {t.title}
              </button>
            ))}
          {!data.threads.length ? (
            <p className="sidebar-hint">记录之后，AI 会把相关想法放在一起。</p>
          ) : null}
        </div>
        <div className="sidebar-footer">
          <button onClick={() => setSettings(true)}>设置与数据</button>
          <p>
            {data.pendingSync
              ? `${data.pendingSync} 项事件待备份`
              : "本地历史已保存"}
          </p>
        </div>
      </nav>
      <main className="main-pane">
        <header className="main-header">
          <div>
            <h1>{title}</h1>
            <p>
              {thread
                ? "你的想法会继续生长，过去的原话始终保留。"
                : "先记录，再整理。让每一次思想变化都有来处。"}
            </p>
          </div>
          <div className="header-actions">
            <button
              disabled={working > 0 || !data.settings.hasDavPassword}
              onClick={() => action(() => window.uki.sync())}
            >
              同步
            </button>
            {!panel ? (
              <button onClick={() => setPanel(true)}>当前认知</button>
            ) : null}
          </div>
        </header>
        <div className="search-row">
          <input
            type="search"
            aria-label="搜索历史"
            placeholder="找回过去的原话、标题或概述"
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>{data.aiStatus}</span>
        </div>
        {error ? (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button aria-label="关闭提示" onClick={() => setError("")}>
              关闭
            </button>
          </div>
        ) : null}
        <div className="records">
          {notes.length ? (
            notes.map((note) => (
              <div id={`note-${note.id}`} key={note.id}>
                <RecordCard
                  note={note}
                  threads={data.threads}
                  expanded={openNote === note.id}
                  onOpen={() =>
                    setOpenNote(openNote === note.id ? null : note.id)
                  }
                  onAction={action}
                />
              </div>
            ))
          ) : (
            <div className="empty-state">
              <span className="empty-line" />
              <h2>
                {query
                  ? "还没找到相关记录"
                  : pendingOnly
                    ? "记录都处理好了"
                    : "一个问题，可以想很久"}
              </h2>
              <p>
                {query
                  ? "试试更短的关键词。原文、标题和概述都可以查找。"
                  : "写下现在的想法。以后回来时，你可以看见自己怎样走到这里。"}
              </p>
              {!data.settings.hasApiKey ? (
                <button onClick={() => setSettings(true)}>
                  配置 DeepSeek，开启一起思考
                </button>
              ) : null}
            </div>
          )}
        </div>
        <div className="composer">
          <div className="composer-tabs">
            <button
              className={mode === "note" ? "selected" : ""}
              onClick={() => setMode("note")}
            >
              记录想法
            </button>
            <button
              disabled={!selected}
              className={mode === "discussion" ? "selected" : ""}
              onClick={() => setMode("discussion")}
            >
              继续讨论
            </button>
            {mode === "discussion" ? (
              <label className="pro-toggle">
                <input
                  type="checkbox"
                  checked={pro}
                  onChange={(e) => setPro(e.target.checked)}
                />
                本次使用 Pro
              </label>
            ) : null}
          </div>
          <textarea
            id="capture"
            aria-label="写下想法"
            placeholder={
              mode === "discussion"
                ? "还有哪里值得追问？"
                : "想到什么，直接写下来。"
            }
            value={raw}
            maxLength={50000}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void capture();
              }
            }}
          />
          <div className="composer-footer">
            <span>
              {saving ? "正在保存原文" : "原文先保存 · Ctrl + Enter 记录"}
            </span>
            <button
              className="primary"
              disabled={!raw.trim() || saving}
              onClick={() => {
                void capture();
              }}
            >
              {mode === "discussion" ? "发送并讨论" : "保存想法"}
            </button>
          </div>
        </div>
        <footer className="sync-status" aria-live="polite">
          {data.syncStatus}
        </footer>
      </main>
      {panel ? (
        <CognitionPanel
          data={data}
          threadId={selected}
          onClose={() => setPanel(false)}
          onAction={action}
          onEvidence={showEvidence}
        />
      ) : null}
      {settings ? (
        <SettingsModal
          data={data}
          onClose={() => setSettings(false)}
          onAction={action}
        />
      ) : null}
    </div>
  );
}
