import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  Bootstrap,
  AiTask,
  Evidence,
  Note,
  Proposal,
  Recap,
  StructureProposal,
  Thread,
  ThreadResources,
  WorkspacePage,
  WorkspaceState,
} from "../shared";
import { RecordCard } from "./RecordCard";
import {
  CognitionSuggestion,
  RecapContent,
  StructureSuggestion,
} from "./WorkUnits";
import {
  ResourcesPanel,
  type Reference,
  type ExternalReference,
} from "./ResourcesPanel";
import { ResearchCard } from "./ResearchCard";
import type { Research } from "../research";
import { ThreadDialog } from "./ThreadDialog";
import { SettingsModal } from "./SettingsModal";
import { TaskPanel } from "./TaskPanel";
const blank = (): WorkspaceState => ({
  draft: "",
  mode: "note",
  parentNoteId: null,
  openIds: [],
  panel: "closed",
});
const labels: Record<string, string> = {
  all: "想法，从这里开始",
  pending: "待整理",
  organize: "整理建议",
  review: "回顾",
  research: "资料",
  favorites: "收藏",
  trash: "回收站",
};
const cleanError = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
export function App() {
  const [selectedTargets, setSelectedTargets] = useState<
    Record<string, string>
  >({});
  const [data, setData] = useState<Bootstrap | null>(null),
    [workspace, setWorkspace] = useState("all"),
    [state, setState] = useState<WorkspaceState>(blank),
    [ready, setReady] = useState(false);
  const [page, setPage] = useState<WorkspacePage | null>(null),
    [resources, setResources] = useState<ThreadResources | null>(null),
    [reference, setReference] = useState<Reference | null>(null),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [searchIn, setSearchIn] = useState<"original" | "reply">("original"),
    [aiFilter, setAiFilter] = useState<"all" | "pending" | "failed">("all"),
    [date, setDate] = useState("");
  const [settings, setSettings] = useState(false),
    [editingThread, setEditingThread] = useState<Thread | "new" | null>(null),
    [saving, setSaving] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [newContent, setNewContent] = useState(false),
    [prefs, setPrefs] = useState<Record<string, number | boolean | string>>({}),
    [collapsed, setCollapsed] = useState<string[]>([]),
    [loading, setLoading] = useState(false);
  const [resultToShow, setResultToShow] = useState<string | null>(null);
  const [taskPanel, setTaskPanel] = useState(false);
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  useEffect(
    () =>
      window.uki?.onProgress((progress) =>
        setStreaming((value) => ({ ...value, [progress.id]: progress.text })),
      ),
    [],
  );
  const [returnWorkspace, setReturnWorkspace] = useState<string | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]),
    [moveTarget, setMoveTarget] = useState(""),
    [movePreview, setMovePreview] = useState(false),
    [undoMoveId, setUndoMoveId] = useState<string | null>(null),
    [undoTrash, setUndoTrash] = useState<string[]>([]),
    [notice, setNotice] = useState("");
  const [externalReference, setExternalReference] =
    useState<ExternalReference | null>(null);
  const [reload, setReload] = useState(0);
  const seenHead = useRef<{ scope: string; seq: number } | null>(null);
  useEffect(() => {
    if (!resultToShow || !page) return;
    const element = scroll.current?.querySelector<HTMLElement>(
      `[data-unit="${resultToShow}"]`,
    );
    if (element) {
      element.scrollIntoView({ block: "start" });
      setResultToShow(null);
    }
  }, [resultToShow, page]);
  const initialized = useRef(false),
    resourceVersion = useRef(0);
  const live = useRef({ workspace, state }),
    scroll = useRef<HTMLDivElement>(null),
    navVersion = useRef(0),
    pageVersion = useRef(0),
    restoreScroll = useRef<number | "bottom" | null>("bottom"),
    lastSeq = useRef(-1),
    scrollWriting = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  live.current = { workspace, state };
  const readingPosition = () => {
    const container = scroll.current;
    if (!container) return {};
    const top = container.getBoundingClientRect().top;
    const item = [
      ...container.querySelectorAll<HTMLElement>("[data-unit]"),
    ].find((el) => el.getBoundingClientRect().bottom > top);
    return {
      scroll: container.scrollTop,
      anchor: item?.dataset.unit,
      anchorOffset: item ? item.getBoundingClientRect().top - top : undefined,
    };
  };
  const patch = (value: Partial<WorkspaceState>) =>
    setState((s) => ({ ...s, ...value }));
  const thread = data?.threads.find((t) => t.id === workspace),
    threadId = thread?.id ?? null;
  const loadPage = useCallback(async () => {
    if (!ready) return;
    const version = ++pageVersion.current;
    const result = await window.uki.workspace({
      workspace,
      before: state.before,
      query,
      searchIn,
      aiFilter,
      date: date || undefined,
      includeHistory: state.includeHistory,
    });
    if (
      version === pageVersion.current &&
      workspace === live.current.workspace &&
      state.before === live.current.state.before
    ) {
      const scope = JSON.stringify([workspace, query, searchIn, aiFilter]);
      if (seenHead.current?.scope !== scope) setNewContent(false);
      if (
        seenHead.current?.scope === scope &&
        result.newestSeq > seenHead.current.seq &&
        (state.before ||
          date ||
          (scroll.current?.scrollHeight ?? 0) -
            (scroll.current?.scrollTop ?? 0) -
            (scroll.current?.clientHeight ?? 0) >
            180)
      )
        setNewContent(true);
      seenHead.current = { scope, seq: result.newestSeq };
      setPage(result);
      setLoading(false);
    }
  }, [
    ready,
    workspace,
    state.before,
    state.includeHistory,
    query,
    searchIn,
    aiFilter,
    date,
    reload,
  ]);
  const loadResources = useCallback(async () => {
    const version = ++resourceVersion.current;
    const result = await window.uki.resources(threadId);
    if (
      version === resourceVersion.current &&
      (threadId === live.current.workspace ||
        (threadId === null && Object.hasOwn(labels, live.current.workspace)))
    )
      setResources(result);
  }, [threadId]);
  const refresh = useCallback(async () => {
    const scope = live.current.workspace;
    const next = await window.uki.bootstrap();
    setData(next);
    if (scope !== live.current.workspace) return;
    if (lastSeq.current !== next.latest) {
      lastSeq.current = next.latest;
      await Promise.all([loadPage(), loadResources()]);
    }
  }, [loadPage, loadResources]);
  useEffect(() => {
    if (!window.uki) {
      setError("请通过 Windows 桌面应用打开 ChatNoteUki");
      return;
    }
    let active = true;
    void Promise.all([
      window.uki.bootstrap(),
      window.uki.workspaceState("all"),
      window.uki.preferences(),
    ])
      .then(([d, s, p]) => {
        if (!active) return;
        lastSeq.current = d.latest;
        setData(d);
        setState({ ...s, panel: s.panel ?? "closed" });
        setDate(s.date ?? "");
        setQuery(s.query ?? "");
        setSearchIn(s.searchIn ?? "original");
        setAiFilter(s.aiFilter ?? "all");
        restoreScroll.current = s.scroll ?? "bottom";
        setPrefs(p);
        try {
          setCollapsed(JSON.parse(String(p.collapsed ?? "[]")));
        } catch {
          /* use an empty tree state */
        }
        initialized.current = true;
        setReady(true);
      })
      .catch((e) => setError(cleanError(e)));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const off = window.uki.onChanged(() => {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(
        () => void refresh().catch((e) => setError(cleanError(e))),
        120,
      );
    });
    return () => {
      off();
      clearTimeout(refreshTimer.current);
    };
  }, [ready, refresh]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(
      () => void loadPage().catch((e) => setError(cleanError(e))),
      query ? 150 : 0,
    );
    return () => clearTimeout(timer);
  }, [loadPage, ready, query]);
  useEffect(() => {
    if (ready) void loadResources().catch((e) => setError(cleanError(e)));
  }, [ready, loadResources]);
  useEffect(() => {
    if (ready)
      void window.uki
        .workspaceState(workspace, state)
        .catch((e) => setError(cleanError(e)));
  }, [ready, workspace, state]);
  useEffect(() => {
    if (!page || restoreScroll.current === null) return;
    const value = restoreScroll.current;
    restoreScroll.current = null;
    requestAnimationFrame(() => {
      const container = scroll.current;
      if (!container) return;
      container.scrollTop = value === "bottom" ? container.scrollHeight : value;
      if (value !== "bottom" && state.anchor) {
        const item = container.querySelector<HTMLElement>(
          `[data-unit="${state.anchor}"]`,
        );
        if (item)
          container.scrollTop +=
            item.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            (state.anchorOffset ?? 0);
      }
    });
  }, [page]);
  useEffect(() => {
    const save = () => {
      if (!initialized.current) return;
      const { workspace: w, state: s } = live.current;
      void window.uki
        .workspaceState(w, {
          ...s,
          ...readingPosition(),
        })
        .catch(() => {});
    };
    window.addEventListener("beforeunload", save);
    return () => {
      window.removeEventListener("beforeunload", save);
      clearTimeout(scrollWriting.current);
    };
  }, []);
  const action = useCallback(
    (fn: () => Promise<unknown>) => {
      setError("");
      void fn()
        .then(refresh)
        .catch((e) => setError(cleanError(e)));
    },
    [refresh],
  );
  const navigate = async (w: string, focus = false) => {
    if (w === live.current.workspace) {
      if (focus) {
        patch({ before: undefined, date: undefined, anchor: undefined });
        setDate("");
        restoreScroll.current = "bottom";
        document.getElementById("capture")?.focus();
      }
      return;
    }
    const version = ++navVersion.current;
    setLoading(true);
    try {
      const current = live.current;
      await window.uki.workspaceState(current.workspace, {
        ...current.state,
        ...readingPosition(),
      });
      const saved = await window.uki.workspaceState(w);
      if (version !== navVersion.current) return;
      ++pageVersion.current;
      ++resourceVersion.current;
      setResources(null);
      setPage(null);
      setWorkspace(w);
      const specific = !Object.hasOwn(labels, w);
      setState({
        ...saved,
        panel: saved.panel ?? (specific ? "normal" : "closed"),
      });
      restoreScroll.current = saved.scroll ?? "bottom";
      setQuery(saved.query ?? "");
      setSearchIn(saved.searchIn ?? "original");
      setDate(saved.date ?? "");
      setAiFilter(saved.aiFilter ?? "all");
      setSelected([]);
      setSelectedNotes([]);
      setSelectedTargets({});
      setReference(null);
      setExternalReference(null);
      setNewContent(false);
      if (focus)
        setTimeout(() => document.getElementById("capture")?.focus(), 100);
    } catch (e) {
      setError(cleanError(e));
    } finally {
      if (version === navVersion.current) setLoading(false);
    }
  };
  const externalSource = (ownerId: string, sourceId: string) =>
    action(async () => {
      const source = await window.uki.researchSource(ownerId, sourceId);
      setExternalReference({ source });
      setReference(null);
      patch({ panel: state.panel === "closed" ? "normal" : state.panel });
    });
  const evidence = (ref: Evidence) =>
    action(async () => {
      const detail = await window.uki.detail(ref.noteId);
      setReference({ detail, revision: ref.revision });
      setExternalReference(null);
      setState((s) => ({
        ...s,
        panel: s.panel === "closed" ? "normal" : s.panel,
      }));
    });
  const latest = () => {
    setLoading(true);
    setPage(null);
    restoreScroll.current = "bottom";
    patch({ before: undefined, scroll: 0, anchor: undefined, date: undefined });
    setDate("");
    setNewContent(false);
    setReload((n) => n + 1);
  };
  const capture = async () => {
    if (!state.draft.trim() || saving) return;
    setSaving(true);
    setError("");
    const submitted = state.draft;
    if (
      !state.before &&
      !date &&
      (scroll.current?.scrollHeight ?? 0) -
        (scroll.current?.scrollTop ?? 0) -
        (scroll.current?.clientHeight ?? 0) <=
        180
    )
      restoreScroll.current = "bottom";
    try {
      const id = await window.uki.capture({
        raw: submitted,
        threadId: threadId && !thread?.archived ? threadId : null,
        mode: "note",
        parentNoteId: null,
        model: "deepseek-flash",
      });
      setState((s) => ({
        ...s,
        draft: s.draft === submitted ? "" : s.draft,
        openIds: [...s.openIds, id].slice(-100),
      }));
      setNotice(
        "已保存到本机" + (data?.settings.hasDavPassword ? " · 尚未上传" : ""),
      );
      void refresh().catch((e) =>
        setError(
          "原文已保存；界面刷新失败，请重新打开当前工作区。" + cleanError(e),
        ),
      );
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setSaving(false);
    }
  };
  const showResult = (task: AiTask) =>
    action(async () => {
      if (!task.resultId) return;
      if (task.kind === "research") await navigate("research");
      else if (task.threadId) await navigate(task.threadId);
      else return;
      restoreScroll.current = null;
      patch({
        before: task.resultBefore,
        date: undefined,
        anchor: undefined,
        anchorOffset: undefined,
        panel: "closed",
      });
      setDate("");
      setQuery("");
      setAiFilter("all");
      setReload((n) => n + 1);
      setResultToShow(task.resultId);
      setNewContent(false);
    });
  const preference = (key: string, value: string | boolean | number) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    void window.uki.preferences(next).catch((e) => setError(cleanError(e)));
  };
  const flip = (id: string) => {
    const next = collapsed.includes(id)
      ? collapsed.filter((x) => x !== id)
      : [...collapsed, id];
    setCollapsed(next);
    preference("collapsed", JSON.stringify(next));
  };
  const changePage = (before?: number) => {
    setLoading(true);
    setPage(null);
    restoreScroll.current = "bottom";
    patch({ before, scroll: 0, anchor: undefined });
    setSelected([]);
    setSelectedTargets({});
  };
  if (!data)
    return (
      <main className="loading">
        <h1>ChatNoteUki</h1>
        <p>{error || "正在打开你的思考空间…"}</p>
      </main>
    );
  const panel = state.panel ?? "closed",
    active = data.threads
      .filter((t) => !t.archived)
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)),
    font = Number(prefs.font ?? 14),
    left = Number(prefs.left ?? 220),
    right = Number(prefs.right ?? 300),
    title = labels[workspace] ?? thread?.title ?? "思考工作区";
  const style = {
    "--left-width": `${left}px`,
    "--right-width": `${right}px`,
    "--read-size": `${font}px`,
  } as CSSProperties;
  return (
    <div
      className={`app-shell ${prefs.leftClosed ? "left-hidden" : ""} ${panel === "closed" || panel === "max" ? "panel-hidden" : ""} ${panel === "wide" ? "panel-wide" : ""}`}
      style={style}
    >
      {!prefs.leftClosed && (
        <nav className="sidebar" aria-label="思考线程">
          <div className="brand">
            <strong>ChatNoteUki</strong>
            <button
              aria-label="收起左栏"
              onClick={() => preference("leftClosed", true)}
            >
              ◧
            </button>
          </div>
          <button
            className="new-thought"
            onClick={() => void navigate("all", true)}
          >
            ＋ 新想法
          </button>
          <div className="navigation">
            {(
              [
                ["all", "全部记录", data.counts.notes],
                ["favorites", "收藏", undefined],
                ["pending", "待整理", data.counts.unassigned],
                ["organize", "整理建议", data.counts.structures],
                ["review", "回顾", data.counts.recaps],
                ["research", "资料", undefined],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                className={`nav-item ${workspace === id ? "active" : ""}`}
                onClick={() => void navigate(id)}
              >
                {label}
                {count !== null && <span>{count}</span>}
              </button>
            ))}
          </div>
          <div className="threads-label">
            <span>持续思考的问题</span>
            <button
              aria-label="新建问题"
              onClick={() => setEditingThread("new")}
            >
              ＋
            </button>
          </div>
          <div className="thread-list">
            {active
              .filter((t) => !t.parentId)
              .map((t) => (
                <div key={t.id}>
                  <div className="tree-row">
                    <button
                      aria-label={`${collapsed.includes(t.id) ? "展开" : "收起"} ${t.title}`}
                      className="tree-toggle"
                      onClick={() => flip(t.id)}
                    >
                      {active.some((c) => c.parentId === t.id)
                        ? collapsed.includes(t.id)
                          ? "›"
                          : "⌄"
                        : "·"}
                    </button>
                    <button
                      title={t.title}
                      className={`thread-item ${workspace === t.id ? "active" : ""}`}
                      onClick={() => void navigate(t.id)}
                    >
                      {t.title}
                    </button>
                  </div>
                  {!collapsed.includes(t.id) &&
                    active
                      .filter((c) => c.parentId === t.id)
                      .map((c) => (
                        <button
                          key={c.id}
                          title={c.title}
                          className={`thread-item child ${workspace === c.id ? "active" : ""}`}
                          onClick={() => void navigate(c.id)}
                        >
                          {c.title}
                          {c.pinned ? " · 置顶" : ""}
                        </button>
                      ))}
                </div>
              ))}
            {!active.length && (
              <p className="sidebar-hint">
                先记录。相关想法会归入已有问题；新问题建议等你确认。
              </p>
            )}
            {data.threads.some((t) => t.archived) && (
              <details className="archived-problems">
                <summary>已归档问题</summary>
                {data.threads
                  .filter((t) => t.archived)
                  .map((t) => (
                    <button
                      key={t.id}
                      className="thread-item"
                      onClick={() => void navigate(t.id)}
                    >
                      {t.title}
                    </button>
                  ))}
              </details>
            )}
          </div>
          <div className="sidebar-footer">
            <button
              className={workspace === "trash" ? "active" : ""}
              onClick={() => void navigate("trash")}
            >
              回收站
            </button>
            <button onClick={() => setSettings(true)}>设置与数据</button>
            <p>
              {data.pendingSync
                ? `${data.pendingSync} 项变化待上传`
                : "本地历史已保存"}
            </p>
          </div>
        </nav>
      )}
      <main
        className="main-pane"
        onFocusCapture={(e) => {
          if (
            e.target instanceof HTMLTextAreaElement &&
            e.target.closest(
              ".note-reply-form, .composer, .research-card form, .research-controls",
            )
          ) {
            if (
              panel !== "closed" &&
              window.matchMedia("(max-width: 1280px)").matches
            )
              patch({ panel: "closed" });
          }
        }}
      >
        <header className="main-header">
          {returnWorkspace && (
            <button
              onClick={() => {
                const destination = returnWorkspace;
                setReturnWorkspace(null);
                void navigate(destination);
              }}
            >
              返回查找位置
            </button>
          )}
          <div className="heading-left">
            {prefs.leftClosed && (
              <button
                aria-label="展开左栏"
                onClick={() => preference("leftClosed", false)}
              >
                ◧
              </button>
            )}
            <div>
              <span className="eyebrow">思想工作区</span>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="header-actions">
            <button
              disabled={!data.settings.hasDavPassword}
              onClick={() => action(() => window.uki.sync())}
            >
              同步
            </button>
            <button
              onClick={() =>
                patch({ panel: panel === "closed" ? "normal" : "closed" })
              }
            >
              概览
            </button>
          </div>
        </header>
        {workspace === "review" || workspace === "research" ? (
          <p className="review-intro hint">
            {workspace === "research"
              ? "这里保存围绕笔记和问题的资料分析。打开笔记卡片或问题右侧的「查找资料」，确认搜索词后才联网；资料与 AI 判断不会自动成为你的观点。"
              : "这里汇集已生成的线程回顾，附原文引用。生成新回顾请进入具体问题，在右侧点击「生成线程回顾」。"}
          </p>
        ) : (
          <div className="search-row">
            <input
              type="search"
              aria-label="搜索历史"
              placeholder="搜索原文、标题或摘要"
              value={query}
              maxLength={200}
              onChange={(e) => {
                setQuery(e.target.value);
                patch({ before: undefined, query: e.target.value });
              }}
            />
            <select
              aria-label="搜索范围"
              value={searchIn}
              onChange={(e) => {
                setSearchIn(e.target.value as typeof searchIn);
                patch({
                  searchIn: e.target.value as typeof searchIn,
                  before: undefined,
                });
              }}
            >
              <option value="original">原文与派生信息</option>
              <option value="reply">AI 回应</option>
            </select>
            <select
              aria-label="AI 状态筛选"
              value={aiFilter}
              onChange={(e) => {
                setAiFilter(e.target.value as typeof aiFilter);
                patch({
                  before: undefined,
                  aiFilter: e.target.value as typeof aiFilter,
                });
              }}
            >
              <option value="all">全部状态</option>
              <option value="pending">AI 待处理</option>
              <option value="failed">AI 失败</option>
            </select>
            <label className="check">
              <input
                type="checkbox"
                checked={!!state.includeHistory}
                onChange={(e) =>
                  patch({ includeHistory: e.target.checked, before: undefined })
                }
              />
              包含更正历史
            </label>
            {workspace !== "all" && query && (
              <button
                onClick={() => {
                  const keyword = query;
                  void navigate("all").then(() => {
                    setQuery(keyword);
                    patch({ query: keyword, before: undefined });
                  });
                }}
              >
                搜索全部记录
              </button>
            )}
            {(query || aiFilter !== "all" || state.includeHistory) && (
              <button
                onClick={() => {
                  setQuery("");
                  setAiFilter("all");
                  patch({
                    query: "",
                    aiFilter: "all",
                    includeHistory: false,
                    before: undefined,
                  });
                }}
              >
                清除筛选
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button aria-label="关闭提示" onClick={() => setError("")}>
              关闭
            </button>
          </div>
        )}
        {(notice || undoTrash.length > 0 || undoMoveId) && (
          <div className="feedback-bar" role="status">
            <span>{notice}</span>
            {undoTrash.length > 0 && (
              <button
                onClick={() =>
                  action(async () => {
                    await window.uki.trash(undoTrash, "restore");
                    setUndoTrash([]);
                    setNotice("已恢复笔记");
                  })
                }
              >
                撤销删除
              </button>
            )}
            {undoMoveId && (
              <button
                onClick={() =>
                  action(async () => {
                    await window.uki.undoMove(undoMoveId);
                    setUndoMoveId(null);
                    setNotice("已撤销移动");
                  })
                }
              >
                撤销移动
              </button>
            )}
            <button
              aria-label="关闭反馈"
              onClick={() => {
                setNotice("");
                setUndoTrash([]);
                setUndoMoveId(null);
              }}
            >
              ×
            </button>
          </div>
        )}
        {selectedNotes.length > 0 && (
          <div className="bulk-bar">
            <span>已选当前页 {selectedNotes.length} 条笔记</span>
            <select
              aria-label="批量移动目标"
              value={moveTarget}
              onChange={(e) => {
                setMoveTarget(e.target.value);
                setMovePreview(false);
              }}
            >
              <option value="">待整理</option>
              {active.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.parentId ? "↳ " : ""}
                  {t.title}
                </option>
              ))}
            </select>
            {workspace === "trash" ? (
              <button
                onClick={() =>
                  action(async () => {
                    await window.uki.trash(selectedNotes, "restore");
                    setSelectedNotes([]);
                  })
                }
              >
                恢复所选
              </button>
            ) : (
              <>
                <button onClick={() => setMovePreview(true)}>移动预览</button>
                <button
                  onClick={() =>
                    action(() => window.uki.exportNotes(selectedNotes))
                  }
                >
                  导出所选…
                </button>
                <button
                  onClick={() =>
                    action(async () => {
                      await window.uki.trash(selectedNotes, "trash");
                      setUndoTrash(selectedNotes);
                      setSelectedNotes([]);
                      setNotice("已移入回收站");
                    })
                  }
                >
                  移入回收站
                </button>
              </>
            )}
            <button
              onClick={() => {
                setSelectedNotes([]);
                setMovePreview(false);
              }}
            >
              取消选择
            </button>
            {movePreview && (
              <div className="inline-confirm">
                <span>
                  将 {selectedNotes.length} 条笔记及其讨论移动到“
                  {active.find((t) => t.id === moveTarget)?.title ?? "待整理"}
                  ”。
                </span>
                <button
                  onClick={() =>
                    action(async () => {
                      const id = await window.uki.moveBatch(
                        selectedNotes,
                        moveTarget || null,
                      );
                      setUndoMoveId(id);
                      setSelectedNotes([]);
                      setMovePreview(false);
                      setNotice("移动已完成");
                    })
                  }
                >
                  确认移动
                </button>
              </div>
            )}
          </div>
        )}
        {newContent && (
          <div className="new-content">
            <span>有新内容，当前阅读位置已保留</span>
            <button onClick={latest}>查看最新</button>
          </div>
        )}
        <div className="page-bar">
          <button
            disabled={!page?.before || loading}
            onClick={() => changePage(page!.before!)}
          >
            更早记录
          </button>
          {page?.newerBefore && (
            <button onClick={() => changePage(page.newerBefore!)}>
              较新记录
            </button>
          )}
          {(state.before || date) && <button onClick={latest}>回到最新</button>}
          <span>{page?.total ?? "…"} 个记录单元 · 每页最多 30</span>
          <label>
            定位日期
            <input
              type="date"
              aria-label="定位日期"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                restoreScroll.current = "bottom";
                patch({
                  before: undefined,
                  date: e.target.value || undefined,
                  anchor: undefined,
                });
              }}
            />
          </label>
        </div>
        {selected.length > 0 && (
          <div className="bulk-bar">
            <span>已选择 {selected.length} 项</span>
            {(["accept", "defer", "reject"] as const).map((d, i) => (
              <button
                key={d}
                onClick={() =>
                  action(async () => {
                    await window.uki.structure(
                      selected,
                      d,
                      undefined,
                      selectedTargets,
                    );
                    setSelected([]);
                    setSelectedTargets({});
                  })
                }
              >
                {["接受所选", "暂缓所选", "拒绝所选"][i]}
              </button>
            ))}
          </div>
        )}
        <div
          className="records"
          ref={scroll}
          onScroll={() => {
            clearTimeout(scrollWriting.current);
            scrollWriting.current = setTimeout(
              () => patch(readingPosition()),
              200,
            );
          }}
          tabIndex={0}
          aria-label="工作区记录"
          onKeyDown={(e) => {
            if (e.altKey && e.key === "PageUp") {
              e.preventDefault();
              if (page?.before) changePage(page.before);
            }
            if (e.altKey && e.key === "End") {
              e.preventDefault();
              latest();
            }
          }}
        >
          {page?.items.length ? (
            page.items.map((item) =>
              item.kind === "note" ? (
                <RecordCard
                  key={item.value.id}
                  note={item.value as Note}
                  threads={data.threads}
                  expanded={state.openIds.includes(item.value.id)}
                  onOpen={() =>
                    patch({
                      openIds: state.openIds.includes(item.value.id)
                        ? state.openIds.filter((id) => id !== item.value.id)
                        : [...state.openIds, item.value.id].slice(-100),
                    })
                  }
                  onAction={action}
                  onEvidence={evidence}
                  revisionToken={page.latest}
                  tasks={data.tasks}
                  hasApiKey={data.settings.hasApiKey}
                  onResult={showResult}
                  onSource={externalSource}
                  query={query}
                  selected={selectedNotes.includes(item.value.id)}
                  onSelect={() =>
                    setSelectedNotes((s) =>
                      s.includes(item.value.id)
                        ? s.filter((id) => id !== item.value.id)
                        : [...s, item.value.id],
                    )
                  }
                  onDeleted={() => {
                    setUndoTrash([item.value.id]);
                    setNotice("已移入回收站");
                  }}
                  streaming={streaming}
                />
              ) : item.kind === "structure" ? (
                <StructureSuggestion
                  key={item.value.id}
                  value={item.value as StructureProposal}
                  threads={data.threads}
                  onAction={action}
                  onEvidence={evidence}
                  selected={selected.includes(item.value.id)}
                  onTarget={(target) =>
                    setSelectedTargets((v) => {
                      const next = { ...v };
                      if (target) next[item.value.id] = target;
                      else delete next[item.value.id];
                      return next;
                    })
                  }
                  onSelect={(target) => {
                    if (target)
                      setSelectedTargets((v) => ({
                        ...v,
                        [item.value.id]: target,
                      }));
                    setSelected((s) =>
                      s.includes(item.value.id)
                        ? s.filter((id) => id !== item.value.id)
                        : [...s, item.value.id],
                    );
                  }}
                />
              ) : item.kind === "proposal" ? (
                <CognitionSuggestion
                  key={item.value.id}
                  value={item.value as Proposal}
                  version={
                    resources?.thread?.id === (item.value as Proposal).threadId
                      ? resources.cognition.version
                      : undefined
                  }
                  onAction={action}
                  onEvidence={evidence}
                />
              ) : item.kind === "research" ? (
                <ResearchCard
                  key={item.value.id}
                  value={item.value as Research}
                  revisionToken={page.latest}
                  onAction={action}
                  onEvidence={evidence}
                  onSource={externalSource}
                />
              ) : (
                <RecapContent
                  key={item.value.id}
                  value={item.value as Recap}
                  onEvidence={evidence}
                  threadTitle={
                    data.threads.find(
                      (t) => t.id === (item.value as Recap).threadId,
                    )?.title
                  }
                  onThread={
                    workspace === "review"
                      ? (id) => void navigate(id)
                      : undefined
                  }
                />
              ),
            )
          ) : loading ? (
            <div className="empty-state" role="status">
              <p>正在加载记录…</p>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-symbol">✧</div>
              <h2>
                {query
                  ? "还没找到相关记录"
                  : workspace === "research"
                    ? "还没有保存的资料分析"
                    : workspace === "organize"
                      ? "留出时间，慢慢整理"
                      : workspace === "review"
                        ? "还没有生成的回顾"
                        : "一个问题，可以想很久"}
              </h2>
              <p>
                {query
                  ? "试试更短的关键词，或切换原文与 AI 回应的搜索范围。"
                  : workspace === "research"
                    ? "打开一条笔记或进入具体问题，点击「查找资料」。确认可公开的搜索词后，AI 才会联网查找并分析。"
                    : workspace === "pending"
                      ? "归属不确定的记录在这里。AI 失败状态可单独筛选。"
                      : workspace === "organize"
                        ? "后台整理会提出候选建议，确认后才更改归属和结构。"
                        : workspace === "review"
                          ? "进入一个具体问题，在右侧点击「生成线程回顾」。成功生成后会保存在这里；等待和失败的任务不会变成回顾条目。"
                          : "想到什么，先写下来。原话、变化和依据都能留住。"}
              </p>
              {!data.settings.hasApiKey && (
                <button onClick={() => setSettings(true)}>配置 DeepSeek</button>
              )}
            </div>
          )}
        </div>
        {(!["review", "research", "trash", "favorites"].includes(workspace) ||
          !!state.draft) && (
          <div className="composer">
            {workspace === "review" && (
              <p className="hint">
                这是此页保存的未发送草稿。保存为新想法后，可在「全部记录」查看。
              </p>
            )}
            <div className="composer-tabs">
              <strong className="section-label">记录新想法</strong>
              <span>
                {"归入：" +
                  (thread && !thread.archived ? thread.title : "自动整理")}
              </span>
            </div>
            {state.discussionDraftMoved && (
              <p className="hint">
                讨论草稿已移到原笔记的“回复 AI”中。
                <button onClick={() => patch({ discussionDraftMoved: false })}>
                  知道了
                </button>
              </p>
            )}
            <textarea
              id="capture"
              aria-label="写下想法"
              placeholder="想到什么，直接写下来。回复 AI 请打开笔记卡片。"
              value={state.draft}
              maxLength={50000}
              onChange={(e) => patch({ draft: e.target.value })}
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
              <button
                title="将光标放入输入框后按 Win+H。听写由 Windows 处理，需要网络和麦克风；文字进入草稿后由你检查保存。"
                onClick={() => {
                  document
                    .getElementById("capture")
                    ?.focus({ preventScroll: true });
                  setNotice(
                    "按 Win+H 使用 Windows 系统听写，需要网络和麦克风。文字进入草稿，请检查后再保存。",
                  );
                }}
              >
                系统听写 · Win+H
              </button>
              <span>
                {saving ? "保存原文…" : "草稿仅本机保存 · Ctrl + Enter"}
              </span>
              <button
                className="primary"
                disabled={!state.draft.trim() || saving}
                onClick={() => void capture()}
              >
                保存想法
              </button>
            </div>
          </div>
        )}
        <footer className="sync-status" role="status" title={data.syncStatus}>
          <button onClick={() => setTaskPanel(true)} aria-label="打开 AI 任务">
            {data.aiStatus}
          </button>
          <span>{data.syncStatus}</span>
        </footer>
      </main>
      {panel !== "closed" && (
        <ResourcesPanel
          resources={resources}
          reference={reference}
          externalReference={externalReference}
          panel={panel}
          onPanel={(p) => patch({ panel: p })}
          onClear={() => {
            setReference(null);
            setExternalReference(null);
          }}
          onEvidence={evidence}
          onAction={action}
          onManage={setEditingThread}
          tasks={data.tasks}
          hasApiKey={data.settings.hasApiKey}
          onSettings={() => setSettings(true)}
          onResult={showResult}
          onSource={externalSource}
          onLocate={(id) =>
            action(async () => {
              setReturnWorkspace(workspace);
              await navigate("all");
              const d = await window.uki.detail(id);
              setQuery(d.note.title);
              patch({ query: d.note.title, before: undefined, openIds: [id] });
              setResultToShow(id);
            })
          }
        />
      )}
      {taskPanel && (
        <TaskPanel onClose={() => setTaskPanel(false)} onAction={action} />
      )}
      {settings && (
        <SettingsModal
          data={data}
          onClose={() => setSettings(false)}
          onAction={action}
        />
      )}{" "}
      {editingThread && (
        <ThreadDialog
          thread={editingThread === "new" ? undefined : editingThread}
          threads={data.threads}
          onAction={action}
          onClose={() => setEditingThread(null)}
        />
      )}
      <details className="reading-preferences">
        <summary aria-label="阅读设置">Aa</summary>
        <label>
          字号
          <input
            type="range"
            min={13}
            max={20}
            value={font}
            onChange={(e) => preference("font", +e.target.value)}
          />
        </label>
        <label>
          左栏宽度
          <input
            type="range"
            min={180}
            max={280}
            value={left}
            onChange={(e) => preference("left", +e.target.value)}
          />
        </label>
        <label>
          右栏宽度
          <input
            type="range"
            min={280}
            max={420}
            value={right}
            onChange={(e) => preference("right", +e.target.value)}
          />
        </label>
      </details>
    </div>
  );
}
