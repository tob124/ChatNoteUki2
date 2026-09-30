import { useEffect, useRef, useState } from "react";
import type { AppView, Settings } from "../shared";
export function SettingsModal({
  data,
  onClose,
  onAction,
}: {
  data: AppView;
  onClose(): void;
  onAction(action: () => Promise<unknown>): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<Settings>({
    davUrl: data.settings.davUrl,
    davUser: data.settings.davUser,
    directory: data.settings.directory,
    dailyInputLimit: data.settings.dailyInputLimit,
    dailyOutputLimit: data.settings.dailyOutputLimit,
  });
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [confirmRestore, setConfirmRestore] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog ref={dialog} className="settings-dialog" onCancel={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAction(async () => {
            await window.uki.saveSettings(
              settings,
              key || undefined,
              password || undefined,
            );
            setKey("");
            setPassword("");
            onClose();
          });
        }}
      >
        <header>
          <h2>设置与数据</h2>
          <button type="button" aria-label="关闭设置" onClick={onClose}>
            关闭
          </button>
        </header>
        <h3>DeepSeek</h3>
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
            每日输入预算（tokens）
            <input
              type="number"
              min={8000}
              max={1000000}
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
            每日输出预算（tokens）
            <input
              type="number"
              min={1000}
              max={100000}
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
          inbox.txt，以空行分隔笔记。先完成手机上传，再启动电脑或点击同步；原文归档成功后才条件清空。手机随后上传旧副本仍可能覆盖云端文件。
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
        <p className="hint">
          累计用量：输入{" "}
          {data.usage.reduce((s, u) => s + u.input, 0).toLocaleString()} / 输出{" "}
          {data.usage.reduce((s, u) => s + u.output, 0).toLocaleString()}{" "}
          tokens。网络中断时供应商可能仍计费，显示用量仅含已返回结果。
        </p>
        {data.reservations.length ? (
          <p className="hint">
            另有 {data.reservations.length}{" "}
            次请求的计费无法确认，按单次最大用量计入当日预算；可查看 DeepSeek
            账单核对。
          </p>
        ) : null}
        {data.batches.length ? (
          <details className="import-history">
            <summary>手机导入记录与原文件快照</summary>
            {data.batches
              .slice()
              .reverse()
              .map((batch) => (
                <details key={batch.id}>
                  <summary>
                    {new Date(batch.createdAt).toLocaleString("zh-CN")} ·{" "}
                    {batch.status === "cleared"
                      ? "已清空"
                      : batch.status === "conflict"
                        ? "内容冲突，需核对"
                        : "已保存，待清空"}{" "}
                    · {batch.items.length} 条
                  </summary>
                  <pre>{batch.snapshot}</pre>
                </details>
              ))}
          </details>
        ) : null}
      </form>
    </dialog>
  );
}
