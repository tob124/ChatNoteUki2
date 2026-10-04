import { z } from "zod";
import type {
  ResearchInput,
  ResearchCheckpoint,
  Research,
  ResearchSource,
} from "./research";

export const stateContentSchema = z.object({
  viewpoint: z.string().max(200000),
  reasons: z.array(z.string().max(64000)).max(200),
  uncertainties: z.array(z.string().max(64000)).max(200),
  questions: z.array(z.string().max(64000)).max(200),
  decisions: z.array(z.string().max(64000)).max(200),
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
  pinned?: boolean;
  id: string;
  title: string;
  createdAt: string;
  parentId?: string | null;
  description?: string;
  archived?: boolean;
  revision?: number;
}
export interface Note {
  partialReply?: string;
  deletedAt?: string | null;
  purged?: boolean;
  bookmarked?: boolean;
  componentErrors?: Record<string, string>;
  researchId?: string;
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
  status: "pending" | "running" | "done" | "failed" | "partial" | "cancelled";
  error: string | null;
  processing?: {
    input: string;
    versions: Evidence[];
    revision: number;
    usage?: { input: number; output: number };
  };
  previewKind?: "original" | "synopsis";
  originalThreadId?: string | null;
  revision?: number;
  assignmentRevision?: number;
  titleLocked?: boolean;
  assignmentLocked?: boolean;
  currentRaw?: string;
  parentNoteId?: string | null;
  parentRevision?: number;
  legacy?: boolean;
  edition?: 3;
  reentered?: boolean;
}
export interface Evidence {
  noteId: string;
  revision: number;
}
export interface NoteRevision {
  id: string;
  noteId: string;
  revision: number;
  raw: string;
  createdAt: string;
}
export interface StructureProposal {
  id: string;
  kind: "create" | "assign" | "merge" | "reparent";
  title: string;
  description: string;
  parentId: string | null;
  targetId: string | null;
  sourceIds: string[];
  noteIds: string[];
  reason: string;
  evidence: Evidence[];
  fingerprint: string;
  bases: {
    threads: Record<string, number>;
    notes: Record<string, number>;
    raws?: Record<string, number>;
  };
  status: "pending" | "accepted" | "rejected" | "deferred" | "undone";
  createdAt: string;
  undo?: {
    threads: Thread[];
    notes: {
      id: string;
      threadId: string | null;
      assignmentRevision: number;
      assignmentLocked?: boolean;
    }[];
    after: Record<string, number>;
    createdId?: string;
  };
}
export interface AiTask {
  id: string;
  kind: "organize" | "cognition" | "recap" | "research";
  noteIds: string[];
  threadId: string | null;
  model: Note["model"];
  status:
    | "pending"
    | "running"
    | "done"
    | "failed"
    | "budget"
    | "cancelled"
    | "partial";
  research?: ResearchInput;
  checkpoint?: ResearchCheckpoint;
  researchStage?: ResearchCheckpoint["stage"];
  sourceCount?: number;
  sourceLabels?: Pick<ResearchSource, "id" | "title" | "status">[];
  candidate?: { content: string; finishReason: string | null } | null;
  createdAt: string;
  error: string | null;
  input?: string;
  inputVersions?: Evidence[];
  budgetDay?: string;
  result?: unknown;
  resultId?: string;
  resultBefore?: number;
}
export interface Recap {
  id: string;
  threadId: string;
  createdAt: string;
  start: string;
  end: string;
  total: number;
  sampled: number;
  baseVersion: number;
  evidence: Evidence[];
  expressed: string;
  possible: string;
  questions: string;
}
export interface WorkspaceQuery {
  includeHistory?: boolean;
  bookmarked?: boolean;
  workspace: string;
  before?: number;
  date?: string;
  query?: string;
  searchIn?: "original" | "reply";
  aiFilter?: "all" | "pending" | "failed";
}
export interface WorkspaceItem {
  seq: number;
  kind: "note" | "structure" | "proposal" | "recap" | "research";
  value: Note | StructureProposal | Proposal | Recap | Research;
}
export interface WorkspacePage {
  items: WorkspaceItem[];
  before: number | null;
  newerBefore: number | null;
  latest: number;
  total: number;
  newestSeq: number;
}
export interface WorkspaceState {
  query?: string;
  searchIn?: "original" | "reply";
  aiFilter?: "all" | "pending" | "failed";
  includeHistory?: boolean;
  bookmarked?: boolean;
  draft: string;
  mode: "note" | "discussion";
  parentNoteId: string | null;
  parentRevision?: number;
  parentTitle?: string;
  before?: number;
  anchor?: string;
  anchorOffset?: number;
  date?: string;
  openIds: string[];
  panel?: "closed" | "normal" | "wide" | "max";
  scroll?: number;
  discussionDraftMoved?: boolean;
}
export interface SyncDiagnostic {
  method: string;
  path: string;
  status: number;
  duration: number;
  at: string;
}
export interface Bootstrap {
  threads: Thread[];
  counts: {
    notes: number;
    unassigned: number;
    failed: number;
    structures: number;
    recaps: number;
  };
  settings: SettingsView;
  syncStatus: string;
  aiStatus: string;
  deviceId: string;
  pendingSync: number;
  canRestore: boolean;
  latest: number;
  profile: string;
  version: string;
  diagnostics: SyncDiagnostic[];
  tasks: AiTask[];
  statistics: { read: number; written: number; lastCheck: string | null };
}
export interface ThreadResources {
  thread: Thread | null;
  cognition: Cognition;
  proposals: Proposal[];
  recaps: Recap[];
  researches?: Research[];
  cognitionHistory: Cognition[];
  count: number;
  recapDue: boolean;
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
  evidence?: Evidence[];
}
export interface InboxItem {
  id: string;
  raw: string;
}
export interface InboxBatch {
  snapshotHash?: string;
  itemHashes?: string[];
  redacted?: boolean;
  id: string;
  snapshot: string;
  etag: string | null;
  items: InboxItem[];
  status: "pending" | "cleared" | "conflict";
  createdAt: string;
}
export interface Usage {
  estimated?: boolean;
  searches?: number;
  id: string;
  input: number;
  output: number;
  model: string;
  createdAt: string;
}
export interface Snapshot {
  researches?: Research[];
  notes: Note[];
  threads: Thread[];
  cognitions: Cognition[];
  proposals: Proposal[];
  batches: InboxBatch[];
  usage: Usage[];
  reservations: Usage[];
  structures: StructureProposal[];
  tasks: AiTask[];
  recaps: Recap[];
}
export const settingsSchema = z.object({
  hardBudget: z.boolean().default(false),
  contextTokens: z.number().int().min(8000).max(131072).default(32768),
  davUrl: z.string().url().default("https://dav.jianguoyun.com/dav/"),
  davUser: z.string().max(300).default(""),
  directory: z.string().max(200).default("ChatNoteUki"),
  autoSync: z.boolean().default(true),
  syncIntervalSeconds: z.number().int().min(60).max(600).default(60),
  dailyInputLimit: z.number().int().min(8000).max(10000000).default(500000),
  dailyOutputLimit: z.number().int().min(1000).max(1000000).default(100000),
  structureSensitivity: z.enum(["保守", "均衡", "积极"]).default("保守"),
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
export const captureSchema = z
  .object({
    researchId: z.string().uuid().optional(),
    raw: z
      .string()
      .min(1)
      .max(50000)
      .refine((s) => s.trim().length > 0, "请输入内容"),
    threadId: z.string().uuid().nullable().default(null),
    parentNoteId: z.string().uuid().nullable().default(null),
    parentRevision: z.number().int().nonnegative().optional(),
    mode: z.enum(["note", "discussion"]).default("note"),
    model: z
      .enum(["deepseek-flash", "deepseek-v4-pro"])
      .default("deepseek-flash"),
  })
  .refine(
    (input) => input.mode === "discussion" || input.model === "deepseek-flash",
    "Pro 仅用于主动讨论，自动记录使用 Flash",
  );
export type Capture = z.input<typeof captureSchema>;
export const aiNoteSchema = z.object({
  threadId: z.string().uuid().nullable(),
  newThreadTitle: z.string().max(60).nullable(),
  title: z.string().trim().min(1).max(64000),
  synopsis: z.string().max(64000),
  reply: z.string().trim().max(200000),
  newParentId: z.string().uuid().nullable().optional(),
  threadDescription: z.string().max(500).optional(),
});
export type AiNoteResult = z.infer<typeof aiNoteSchema>;
export const eventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "note.added",
    "note.started",
    "note.completed",
    "note.failed",
    "note.deferred",
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
    "library.migrated",
    "library.raw-reimported",
    "thread.updated",
    "note.corrected",
    "note.titled",
    "structure.added",
    "structure.amended",
    "structure.resolved",
    "structure.undone",
    "task.added",
    "task.updated",
    "recap.added",
    "research.added",
    "ai.attempt",
    "note.trashed",
    "note.restored",
    "note.purged",
    "note.bookmarked",
    "note.cancelled",
    "thread.pinned",
    "cognition.edited",
    "material.updated",
    "notes.move-batch",
    "notes.undo-move",
  ]),
  payload: z.unknown(),
  createdAt: z.string().datetime(),
});
export type ThoughtEvent = z.infer<typeof eventSchema>;
export interface UkiApi {
  onProgress(
    callback: (progress: { id: string; text: string }) => void,
  ): () => void;
  aiTasks(): Promise<
    {
      id: string;
      kind: "note" | "task";
      title: string;
      status: string;
      stage: string;
      error: string | null;
    }[]
  >;
  referenceTitles(ids: string[]): Promise<Record<string, string>>;
  trash(ids: string[], operation: "trash" | "restore" | "purge"): Promise<void>;
  bookmark(id: string, value: boolean): Promise<void>;
  pin(id: string, value: boolean): Promise<void>;
  conversations(
    id: string,
    before?: string,
  ): Promise<{ items: Note[]; before: string | null }>;
  editCognition(
    threadId: string,
    baseVersion: number,
    content: StateContent,
  ): Promise<void>;
  cancelAi(id: string, kind: "note" | "task"): Promise<void>;
  taskDetail(id: string): Promise<AiTask>;
  exportNotes(ids: string[], threadId?: string): Promise<boolean>;
  moveBatch(ids: string[], threadId: string | null): Promise<string>;
  undoMove(id: string): Promise<void>;
  research(input: ResearchInput): Promise<string>;
  researchDetail(id: string): Promise<Research>;
  researchSource(ownerId: string, sourceId: string): Promise<ResearchSource>;
  cancelResearch(id: string): Promise<void>;
  openSource(url: string): Promise<void>;
  dataReport(before?: number): Promise<{
    batches: {
      seq: number;
      id: string;
      status: string;
      createdAt: string;
      count: number;
    }[];
    before: number | null;
    usage: { input: number; output: number; unknown: number };
  }>;
  importDetail(id: string): Promise<InboxBatch>;
  bootstrap(): Promise<Bootstrap>;
  workspace(query: WorkspaceQuery): Promise<WorkspacePage>;
  detail(
    id: string,
  ): Promise<{ note: Note; revisions: NoteRevision[]; discussions: Note[] }>;
  resources(threadId: string | null): Promise<ThreadResources>;
  workspaceState(
    workspace: string,
    value?: WorkspaceState,
  ): Promise<WorkspaceState>;
  preferences(
    value?: Record<string, number | boolean | string>,
  ): Promise<Record<string, number | boolean | string>>;
  thread(input: {
    id?: string;
    title: string;
    description: string;
    parentId: string | null;
    archived?: boolean;
  }): Promise<string>;
  correct(id: string, raw: string, baseVersion?: number): Promise<void>;
  title(id: string, title: string, baseTitle?: string): Promise<void>;
  structure(
    ids: string[],
    decision: "accept" | "reject" | "defer",
    targetId?: string,
    targets?: Record<string, string>,
  ): Promise<void>;
  undo(id: string): Promise<void>;
  regenerate(id: string): Promise<void>;
  retryTask(id: string): Promise<void>;
  recap(threadId: string, model: Note["model"]): Promise<string>;
  view(): Promise<AppView>;
  capture(input: Capture): Promise<string>;
  search(query: string): Promise<Note[]>;
  retry(noteId: string): Promise<void>;
  move(noteId: string, threadId: string | null): Promise<void>;
  propose(
    threadId: string,
    model: "deepseek-flash" | "deepseek-v4-pro",
  ): Promise<string>;
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
export function isShortNote(raw: string): boolean {
  const text = raw.trim();
  return (
    [...text].length <= 120 &&
    [
      ...new Intl.Segmenter("zh-CN", { granularity: "sentence" }).segment(text),
    ].filter((x) => x.segment.trim()).length <= 2
  );
}
declare global {
  interface Window {
    uki: UkiApi;
  }
}
