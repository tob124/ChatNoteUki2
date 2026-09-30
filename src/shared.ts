import { z } from "zod";

export const stateContentSchema = z.object({
  viewpoint: z.string().max(2000),
  reasons: z.array(z.string().max(1000)).max(12),
  uncertainties: z.array(z.string().max(1000)).max(12),
  questions: z.array(z.string().max(1000)).max(12),
  decisions: z.array(z.string().max(1000)).max(12),
});
export type StateContent = z.infer<typeof stateContentSchema>;
export const emptyContent = (): StateContent => ({
  viewpoint: "",
  reasons: [],
  uncertainties: [],
  questions: [],
  decisions: [],
});
export interface Cognition extends StateContent {
  threadId: string;
  version: number;
}
export interface Thread {
  id: string;
  title: string;
  createdAt: string;
}
export interface Note {
  id: string;
  raw: string;
  title: string;
  synopsis: string;
  reply: string | null;
  threadId: string | null;
  createdAt: string;
  source: "desktop" | "inbox";
  mode: "note" | "discussion";
  model: "deepseek-flash" | "deepseek-v4-pro";
  status: "pending" | "running" | "done" | "failed";
  error: string | null;
}
export interface Proposal {
  id: string;
  threadId: string;
  baseVersion: number;
  before: StateContent;
  after: StateContent;
  reason: string;
  evidenceIds: string[];
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  acceptedContent?: StateContent;
}
export interface InboxItem {
  id: string;
  raw: string;
}
export interface InboxBatch {
  id: string;
  snapshot: string;
  etag: string | null;
  items: InboxItem[];
  status: "pending" | "cleared" | "conflict";
  createdAt: string;
}
export interface Usage {
  id: string;
  input: number;
  output: number;
  model: string;
  createdAt: string;
}
export interface Snapshot {
  notes: Note[];
  threads: Thread[];
  cognitions: Cognition[];
  proposals: Proposal[];
  batches: InboxBatch[];
  usage: Usage[];
  reservations: Usage[];
}
export const settingsSchema = z.object({
  davUrl: z.string().url().default("https://dav.jianguoyun.com/dav/"),
  davUser: z.string().max(300).default(""),
  directory: z.string().max(200).default("ChatNoteUki"),
  dailyInputLimit: z.number().int().min(8000).max(1000000).default(100000),
  dailyOutputLimit: z.number().int().min(1000).max(100000).default(12000),
});
export type Settings = z.infer<typeof settingsSchema>;
export interface SettingsView extends Settings {
  hasApiKey: boolean;
  hasDavPassword: boolean;
}
export interface AppView extends Snapshot {
  settings: SettingsView;
  syncStatus: string;
  aiStatus: string;
  deviceId: string;
  pendingSync: number;
  canRestore: boolean;
}
export const captureSchema = z.object({
  raw: z
    .string()
    .min(1)
    .max(50000)
    .refine((s) => s.trim().length > 0, "请输入内容"),
  threadId: z.string().uuid().nullable().default(null),
  mode: z.enum(["note", "discussion"]).default("note"),
  model: z
    .enum(["deepseek-flash", "deepseek-v4-pro"])
    .default("deepseek-flash"),
});
export type Capture = z.input<typeof captureSchema>;
export const aiNoteSchema = z.object({
  threadId: z.string().uuid().nullable(),
  newThreadTitle: z.string().max(60).nullable(),
  title: z.string().min(1).max(24),
  synopsis: z.string().min(1).max(80),
  reply: z.string().min(1).max(3000),
});
export type AiNoteResult = z.infer<typeof aiNoteSchema>;
export const eventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "note.added",
    "note.started",
    "note.completed",
    "note.failed",
    "note.retried",
    "note.moved",
    "thread.added",
    "proposal.added",
    "proposal.resolved",
    "inbox.observed",
    "inbox.conflict",
    "inbox.cleared",
    "usage.recorded",
    "usage.reserved",
    "usage.released",
  ]),
  payload: z.unknown(),
  createdAt: z.string().datetime(),
});
export type ThoughtEvent = z.infer<typeof eventSchema>;
export interface UkiApi {
  view(): Promise<AppView>;
  capture(input: Capture): Promise<string>;
  search(query: string): Promise<Note[]>;
  retry(noteId: string): Promise<void>;
  move(noteId: string, threadId: string): Promise<void>;
  propose(
    threadId: string,
    model: "deepseek-flash" | "deepseek-v4-pro",
  ): Promise<void>;
  resolve(
    proposalId: string,
    decision: "accept" | "reject",
    content?: StateContent,
  ): Promise<void>;
  saveSettings(
    settings: Settings,
    apiKey?: string,
    davPassword?: string,
  ): Promise<void>;
  sync(): Promise<void>;
  restore(): Promise<void>;
  onChanged(callback: () => void): () => void;
}
declare global {
  interface Window {
    uki: UkiApi;
  }
}
