import { useEffect, useRef, useState } from "react";
import type { Bootstrap, Settings, UkiApi, InboxBatch } from "../shared";
export function SettingsModal({
  data,
  onClose,
  onAction,
}: {
  data: Bootstrap;
  onClose(): void;
  onAction(action: () => Promise<unknown>): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<Settings>({
    hardBudget: data.settings.hardBudget,
    contextTokens: data.settings.contextTokens,
    davUrl: data.settings.davUrl,
    davUser: data.settings.davUser,
    directory: data.settings.directory,
    autoSync: data.settings.autoSync,
    syncIntervalSeconds: data.settings.syncIntervalSeconds,
    dailyInputLimit: data.settings.dailyInputLimit,
    dailyOutputLimit: data.settings.dailyOutputLimit,
    structureSensitivity: data.settings.structureSensitivity,
  });
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [closing, setClosing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty =
    JSON.stringify(settings) !==
      JSON.stringify({
        hardBudget: data.settings.hardBudget,
        contextTokens: data.settings.contextTokens,
        davUrl: data.settings.davUrl,
        davUser: data.settings.davUser,
        directory: data.settings.directory,
        autoSync: data.settings.autoSync,
        syncIntervalSeconds: data.settings.syncIntervalSeconds,
        dailyInputLimit: data.settings.dailyInputLimit,
        dailyOutputLimit: data.settings.dailyOutputLimit,
        structureSensitivity: data.settings.structureSensitivity,
      }) ||
    !!key ||
    !!password;
  const close = () => {
    if (busy) return;
    if (dirty) setClosing(true);
    else onClose();
  };
  const [report, setReport] = useState<Awaited<
      ReturnType<UkiApi["dataReport"]>
    > | null>(null),
    [imported, setImported] = useState<InboxBatch | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          onAction(async () => {
            try {
              await window.uki.saveSettings(
                settings,
                key || undefined,
                password || undefined,
              );
              setKey("");
              setPassword("");
              onClose();
            } catch (e) {
              setError(String(e instanceof Error ? e.message : e));
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        <header>
          <h2>设置与数据</h2>
          <button
            type="button"
            aria-label="关闭设置"
            onClick={close}
            disabled={busy}
          >
            关闭
          </button>
        </header>
        {closing && (
          <div className="inline-confirm" role="alert">
            <p>设置有未保存修改。凭据输入不会自动保存。</p>
            <button disabled={busy} type="submit">
              保存并关闭
            </button>
            <button type="button" onClick={onClose}>
              放弃修改
            </button>
            <button type="button" onClick={() => setClosing(false)}>
              继续编辑
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <h3>DeepSeek</h3>
        <label>
          结构建议敏感度
          <select
            value={settings.structureSensitivity}
            onChange={(e) =>
              setSettings({
                ...settings,
                structureSensitivity: e.target
                  .value as Settings["structureSensitivity"],
              })
            }
          >
            {["保守", "均衡", "积极"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <p className="hint">
          只影响问题的新建、合并和层级建议，不按日期限额。历史整理共用每日预算，新记录和主动讨论优先。
        </p>
        <label>
          API key{" "}
          <span className="muted">
            {data.settings.hasApiKey ? "已保存，留空沿用" : "尚未配置"}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="填写 API key"
          />
        </label>
        <p className="hint">
          自动处理只使用 Flash。原文先保存，一次调用生成分类、标题、概述与回应。
        </p>
        <div className="budget-fields">
          <label>
            每日输入提醒阈值（tokens）
            <input
              type="number"
              min={8000}
              max={10000000}
              value={settings.dailyInputLimit}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  dailyInputLimit: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            每日输出提醒阈值（tokens）
            <input
              type="number"
              min={1000}
              max={1000000}
              value={settings.dailyOutputLimit}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  dailyOutputLimit: Number(e.target.value),
                })
              }
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.hardBudget}
            onChange={(e) =>
              setSettings({ ...settings, hardBudget: e.target.checked })
            }
          />
          启用每日硬上限（达到阈值后暂停请求）
        </label>
        <label>
          上下文容量（tokens）
          <input
            type="number"
            min={8000}
            max={131072}
            step={1}
            value={settings.contextTokens}
            onChange={(e) =>
              setSettings({
                ...settings,
                contextTokens: Number(e.target.value),
              })
            }
          />
        </label>
        <p className="hint">
          默认阈值只提醒。输入使用随安装包提供的离线 tokenizer 估算，实际用量以
          API 返回为准；计费不明的中断等待手动重试。
        </p>
        <h3>坚果云 WebDAV</h3>
        <label>
          服务器地址
          <input
            type="url"
            required
            value={settings.davUrl}
            onChange={(e) =>
              setSettings({ ...settings, davUrl: e.target.value })
            }
          />
        </label>
        <label>
          坚果云账户
          <input
            value={settings.davUser}
            autoComplete="username"
            onChange={(e) =>
              setSettings({ ...settings, davUser: e.target.value })
            }
          />
        </label>
        <label>
          第三方应用密码{" "}
          <span className="muted">
            {data.settings.hasDavPassword
              ? "已保存，留空沿用"
              : "请勿填写登录密码"}
          </span>
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          云端目录
          <input
            required
            pattern="[A-Za-z0-9_-]+"
            value={settings.directory}
            onChange={(e) =>
              setSettings({ ...settings, directory: e.target.value })
            }
          />
        </label>
        <p className="hint">
          手机编辑此目录下的
          inbox.txt，以空行分隔笔记。先完成手机上传，电脑自动导入；原文归档成功后才条件清空。手机随后上传旧副本仍可能覆盖云端文件。
        </p>
        <label className="auto-sync-toggle">
          <input
            type="checkbox"
            checked={settings.autoSync}
            onChange={(e) =>
              setSettings({ ...settings, autoSync: e.target.checked })
            }
          />
          自动同步
        </label>
        <label>
          检查手机输入的间隔
          <select
            disabled={!settings.autoSync}
            value={settings.syncIntervalSeconds}
            onChange={(e) =>
              setSettings({
                ...settings,
                syncIntervalSeconds: Number(e.target.value),
              })
            }
          >
            <option value={60}>每 1 分钟</option>
            <option value={120}>每 2 分钟</option>
            <option value={300}>每 5 分钟</option>
            <option value={600}>每 10 分钟</option>
          </select>
        </label>
        <p className="hint">
          默认开启。电脑上的记录与修改在保存后约 3
          秒自动上传；网络失败时逐步延长重试间隔，最多 15
          分钟。应用关闭时不运行，关闭自动同步后仍可点击「同步」。
        </p>
        <div className="settings-footer">
          <button className="primary" type="submit">
            保存设置
          </button>
          <span className="muted">凭据只加密保存在本机</span>
        </div>
        <hr />
        <h3>换机恢复</h3>
        <p className="hint">
          只支持空白本地库。恢复原文、标题、概述、对话和认知版本，并由这台电脑接管维护。请先保存坚果云设置，并停止旧电脑同步。
        </p>
        {confirmRestore ? (
          <div className="restore-confirm">
            <p>确认从云端恢复并接管维护？</p>
            <button
              type="button"
              className="primary"
              onClick={() =>
                onAction(async () => {
                  await window.uki.restore();
                  onClose();
                })
              }
            >
              确认恢复并接管
            </button>
            <button type="button" onClick={() => setConfirmRestore(false)}>
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!data.canRestore || !data.settings.hasDavPassword}
            onClick={() => setConfirmRestore(true)}
          >
            从云端恢复并接管
          </button>
        )}
        <h3>当前资料库</h3>
        <p className="hint">
          版本 {data.version} · {data.counts.notes} 条记录
          <br />
          资料路径：{data.profile}
          <br />
          维护设备：{data.deviceId}
          <br />
          {data.pendingSync} 项变化待上传
        </p>
        <details
          onToggle={(e) => {
            if (e.currentTarget.open)
              onAction(async () => setReport(await window.uki.dataReport()));
          }}
        >
          <summary>用量与导入凭据</summary>
          {report && (
            <>
              <p className="hint">
                今日实际输入 {report.usage.input} / 输出 {report.usage.output}{" "}
                tokens · {report.usage.unknown} 次请求计费不明，预算已保守预留
              </p>
              {report.batches.map((b) => (
                <p className="hint" key={b.id}>
                  {new Date(b.createdAt).toLocaleString("zh-CN")} · {b.count} 条
                  ·{" "}
                  {
                    {
                      pending: "待归档清空",
                      cleared: "已归档清空",
                      conflict: "需核对改写",
                    }[b.status]
                  }
                  <button
                    type="button"
                    onClick={() =>
                      onAction(async () =>
                        setImported(await window.uki.importDetail(b.id)),
                      )
                    }
                  >
                    查看文件快照
                  </button>
                </p>
              ))}
              {report.before && (
                <button
                  type="button"
                  onClick={() =>
                    onAction(async () =>
                      setReport(await window.uki.dataReport(report.before!)),
                    )
                  }
                >
                  更早导入
                </button>
              )}
              {imported && (
                <pre className="import-snapshot">{imported.snapshot}</pre>
              )}
            </>
          )}
        </details>
        <p className="hint">
          累计请求：读取 {data.statistics.read} 次 · 写入{" "}
          {data.statistics.written} 次<br />
          最近检查：
          {data.statistics.lastCheck
            ? new Date(data.statistics.lastCheck).toLocaleString("zh-CN")
            : "尚未检查"}
          <br />
          最近成功上传：
          {data.statistics.lastUpload
            ? new Date(data.statistics.lastUpload).toLocaleString("zh-CN")
            : "尚未上传思想变化"}
        </p>
        <details>
          <summary>同步诊断 · 最近 {data.diagnostics.length} 次请求</summary>
          <p className="hint">{data.syncStatus}</p>
          <div className="diagnostics">
            {data.diagnostics
              .slice()
              .reverse()
              .map((r, i) => (
                <div key={i}>
                  {new Date(r.at).toLocaleTimeString("zh-CN")} {r.method}{" "}
                  {r.path || "目录"} · {r.status || "连接失败"} · {r.duration}ms
                </div>
              ))}
          </div>
        </details>
        <details>
          <summary>AI 任务</summary>
          {data.tasks.map((t) => (
            <p className="hint" key={t.id}>
              {t.kind === "organize"
                ? "历史整理"
                : t.kind === "recap"
                  ? "回顾"
                  : t.kind === "research"
                    ? "资料分析"
                    : "认知分析"}{" "}
              ·{" "}
              {
                {
                  pending: "等待",
                  running: "处理中",
                  done: "完成",
                  failed: "失败",
                  budget: "预算等待",
                  cancelled: "已取消",
                  partial: "部分完成",
                }[t.status]
              }{" "}
              {t.error}
              {["failed", "budget"].includes(t.status) && (
                <button
                  type="button"
                  onClick={() => onAction(() => window.uki.retryTask(t.id))}
                >
                  重试任务
                </button>
              )}
            </p>
          ))}
        </details>
      </form>
    </dialog>
  );
}
