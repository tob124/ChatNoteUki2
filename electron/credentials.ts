import { readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { safeStorage } from "electron";
import { z } from "zod";
import { settingsSchema, type SettingsView } from "../src/shared";

const diskSchema = z.object({
  settings: settingsSchema,
  apiKey: z.string().optional(),
  davPassword: z.string().optional(),
  revision: z.number().int().nonnegative().default(0),
});
export class Credentials {
  private disk: z.infer<typeof diskSchema>;
  constructor(
    private path: string,
    defaults?: Partial<import("../src/shared").Settings>,
  ) {
    this.disk = existsSync(path)
      ? diskSchema.parse(JSON.parse(readFileSync(path, "utf8")))
      : { settings: settingsSchema.parse(defaults ?? {}), revision: 0 };
  }
  settings() {
    return { ...this.disk.settings };
  }
  view(): SettingsView {
    return {
      ...this.settings(),
      hasApiKey: !!this.disk.apiKey,
      hasDavPassword: !!this.disk.davPassword,
    };
  }
  private decode(text?: string): string {
    return text ? safeStorage.decryptString(Buffer.from(text, "base64")) : "";
  }
  apiKey() {
    return this.decode(this.disk.apiKey);
  }
  davPassword() {
    return this.decode(this.disk.davPassword);
  }
  revision() {
    return this.disk.revision;
  }
  save(input: unknown, apiKey?: string, davPassword?: string) {
    const settings = settingsSchema.parse(input);
    const url = new URL(settings.davUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("WebDAV 地址须为不含凭据和查询参数的 HTTPS 地址");
    if (!/^[A-Za-z0-9_-]+$/.test(settings.directory))
      throw new Error("目录请使用英文字母、数字、连字符或下划线");
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Windows 凭据加密暂不可用，未保存配置");
    const next = { ...this.disk, settings };
    if (
      davPassword !== undefined ||
      settings.davUrl !== this.disk.settings.davUrl ||
      settings.davUser !== this.disk.settings.davUser ||
      settings.directory !== this.disk.settings.directory
    )
      next.revision++;
    if (apiKey !== undefined)
      next.apiKey = apiKey
        ? safeStorage.encryptString(apiKey).toString("base64")
        : undefined;
    if (davPassword !== undefined)
      next.davPassword = davPassword
        ? safeStorage.encryptString(davPassword).toString("base64")
        : undefined;
    writeFileSync(this.path + ".tmp", JSON.stringify(next), { mode: 0o600 });
    renameSync(this.path + ".tmp", this.path);
    this.disk = next;
  }
}
