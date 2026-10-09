import { useEffect, useRef, useState } from "react";
import type { SavedQuery, SavedQueryInput } from "../workspace-tools";
import type { Thread } from "../shared";
export function SearchTools({
  value,
  threads,
  onChange,
  onOpen,
  onAll,
  onError,
}: {
  value: SavedQueryInput;
  threads: Thread[];
  onChange(v: Partial<SavedQueryInput>): void;
  onOpen(query: SavedQuery): Promise<void>;
  onAll(): void;
  onError(e: string): void;
}) {
  const [items, setItems] = useState<SavedQuery[]>([]),
    [name, setName] = useState(""),
    [edit, setEdit] = useState<SavedQuery | null>(null),
    [form, setForm] = useState(false),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<string>();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (details.current?.open && !details.current.contains(e.target as Node))
        details.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const close = () => {
    if (details.current) {
      details.current.open = false;
      details.current.querySelector<HTMLElement>("summary")?.focus();
    }
  };
  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setItems(await window.uki.savedQueries());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const filtered =
    value.aiFilter !== "all" ||
    value.includeHistory ||
    value.searchIn !== "original";
  return (
    <details
      className="search-tools"
      ref={details}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
      onToggle={(e) => {
        if (e.currentTarget.open) void act(async () => {});
      }}
    >
      <summary>筛选与查询{filtered ? " · 已筛选" : ""}</summary>
      <div className="search-popover">
        <h3>搜索范围</h3>
        <p className="hint">
          {threads.find((t) => t.id === value.workspace)?.title ??
            (value.workspace === "favorites"
              ? "收藏笔记"
              : value.workspace === "history"
                ? "历史资料"
                : value.workspace === "pending"
                  ? "待整理"
                  : "全部记录")}
        </p>
        <label>
          内容
          <select
            aria-label="搜索范围"
            value={value.searchIn}
            onChange={(e) =>
              onChange({
                searchIn: e.target.value as SavedQueryInput["searchIn"],
              })
            }
          >
            <option value="original">原文与派生信息</option>
            <option value="reply">AI 回应</option>
          </select>
        </label>
        <label>
          处理状态
          <select
            aria-label="AI 状态筛选"
            value={value.aiFilter}
            onChange={(e) =>
              onChange({
                aiFilter: e.target.value as SavedQueryInput["aiFilter"],
              })
            }
          >
            <option value="all">全部状态</option>
            <option value="pending">AI 待处理</option>
            <option value="failed">AI 失败</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={value.includeHistory}
            onChange={(e) => onChange({ includeHistory: e.target.checked })}
          />
          包含更正历史
        </label>
        <div className="record-actions">
          {value.workspace !== "all" && value.query && (
            <button
              onClick={() => {
                onAll();
                close();
              }}
            >
              搜索全部记录
            </button>
          )}
          <button
            onClick={() =>
              onChange({
                query: "",
                searchIn: "original",
                aiFilter: "all",
                includeHistory: false,
              })
            }
          >
            清除筛选
          </button>
          <button
            disabled={
              busy ||
              (!["all", "pending", "favorites", "history"].includes(
                value.workspace,
              ) &&
                !threads.some((t) => t.id === value.workspace))
            }
            onClick={() => {
              setEdit(null);
              setName(value.query.slice(0, 30) || "常用查询");
              setForm(true);
            }}
          >
            保存当前查询…
          </button>
        </div>
        {form && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await window.uki.saveQuery({ ...(edit ?? value), name });
                setForm(false);
              });
            }}
          >
            <label>
              查询名称
              <input
                aria-label="查询名称"
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>
            <div className="record-actions">
              <button className="primary" disabled={busy || !name.trim()}>
                保存查询
              </button>
              <button type="button" onClick={() => setForm(false)}>
                取消
              </button>
            </div>
          </form>
        )}
        <h3>已保存查询</h3>
        {!items.length && (
          <p className="hint">
            保存常用条件，下次直接打开；笔记仍保留在原问题中。
          </p>
        )}
        {items.map((q) => (
          <div className="saved-query" key={q.id}>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await onOpen(q);
                  close();
                })
              }
            >
              {q.name}
            </button>
            <details>
              <summary aria-label={`管理查询 ${q.name}`}>···</summary>
              <button
                onClick={() => {
                  setEdit(q);
                  setName(q.name);
                  setForm(true);
                }}
              >
                重命名
              </button>
              <button onClick={() => setRemove(q.id)}>删除查询…</button>
            </details>
            {remove === q.id && (
              <div className="inline-confirm">
                <span>只删除保存的查询，笔记保留。</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await window.uki.deleteQuery(q.id);
                      setRemove(undefined);
                    })
                  }
                >
                  确认删除查询
                </button>
                <button onClick={() => setRemove(undefined)}>取消</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
