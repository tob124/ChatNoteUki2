import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  aiNoteSchema,
  captureSchema,
  emptyContent,
  eventSchema,
  stateContentSchema,
  isShortNote,
  type Cognition,
  type Note,
  type Thread,
  type Proposal,
  type Snapshot,
  type ThoughtEvent,
  type Usage,
  type InboxBatch,
  type StructureProposal,
  type AiTask,
  type Recap,
  type Evidence,
  type NoteRevision,
  type WorkspaceQuery,
  type WorkspacePage,
  type WorkspaceState,
  type ThreadResources,
} from "../src/shared";

const uuid = z.string().uuid(),
  natural = z.number().int().nonnegative();
const evidenceSchema = z.object({ noteId: uuid, revision: natural });
const threadSchema = z.object({
  id: uuid,
  title: z.string().min(1).max(60),
  createdAt: z.string().datetime(),
  parentId: uuid.nullable().optional(),
  description: z.string().max(500).optional(),
  archived: z.boolean().optional(),
  revision: natural.optional(),
});
const noteSchema = z.object({
  id: uuid,
  raw: z.string().min(1).max(50000),
  title: z.string().max(200),
  synopsis: z.string().max(80),
  reply: z.string().nullable(),
  threadId: uuid.nullable(),
  createdAt: z.string().datetime(),
  source: z.enum(["desktop", "inbox"]),
  mode: z.enum(["note", "discussion"]),
  model: z.enum(["deepseek-flash", "deepseek-v4-pro"]),
  status: z.enum(["pending", "running", "done", "failed"]),
  error: z.string().nullable(),
  revision: natural.optional(),
  assignmentRevision: natural.optional(),
  parentNoteId: uuid.nullable().optional(),
  parentRevision: natural.optional(),
  legacy: z.boolean().optional(),
});
const batchSchema = z.object({
  id: uuid,
  snapshot: z.string().max(4000000),
  etag: z.string().max(500).nullable(),
  items: z
    .array(z.object({ id: uuid, raw: z.string().min(1).max(50000) }))
    .max(10000),
  status: z.literal("pending"),
  createdAt: z.string().datetime(),
});
const usageSchema = z.object({
  id: uuid,
  input: natural,
  output: natural,
  model: z.string().max(100),
  createdAt: z.string().datetime(),
});
const basesSchema = z.object({
  threads: z.record(uuid, natural),
  notes: z.record(uuid, natural),
  raws: z.record(uuid, natural).optional(),
});
export const structureInputSchema = z.object({
  kind: z.enum(["create", "assign", "merge", "reparent"]),
  title: z.string().min(1).max(60),
  description: z.string().max(500).default(""),
  parentId: uuid.nullable().default(null),
  targetId: uuid.nullable().default(null),
  sourceIds: z.array(uuid).max(40).default([]),
  noteIds: z.array(uuid).max(10000).default([]),
  reason: z.string().min(1).max(2000),
  evidence: z.array(evidenceSchema).max(30),
});
const taskSchema = z.object({
  id: uuid,
  kind: z.enum(["organize", "cognition", "recap"]),
  noteIds: z.array(uuid).max(10),
  threadId: uuid.nullable(),
  model: z.enum(["deepseek-flash", "deepseek-v4-pro"]),
  status: z.literal("pending"),
  createdAt: z.string().datetime(),
  error: z.string().nullable(),
});
const schemas = {
  "note.added": noteSchema,
  "note.started": z.object({
    id: uuid,
    input: z.string().max(32000).optional(),
    inputVersions: z.array(evidenceSchema).max(30).optional(),
    inputRevision: natural.optional(),
  }),
  "note.completed": z.object({
    id: uuid,
    result: aiNoteSchema,
    threadId: uuid.nullable(),
    inputRevision: natural.optional(),
    usage: z.object({ input: natural, output: natural }).optional(),
  }),
  "note.failed": z.object({ id: uuid, error: z.string().max(1000) }),
  "note.retried": z.object({ id: uuid }),
  "note.moved": z.object({ id: uuid, threadId: uuid.nullable() }),
  "note.corrected": z.object({ id: uuid, raw: z.string().min(1).max(50000) }),
  "note.titled": z.object({ id: uuid, title: z.string().min(1).max(60) }),
  "thread.added": threadSchema,
  "thread.updated": z.object({
    id: uuid,
    title: z.string().min(1).max(60),
    description: z.string().max(500),
    parentId: uuid.nullable(),
    archived: z.boolean(),
  }),
  "proposal.added": z.object({
    id: uuid,
    threadId: uuid,
    baseVersion: natural,
    before: stateContentSchema,
    after: stateContentSchema,
    reason: z.string().max(2000),
    evidenceIds: z.array(uuid).max(20),
    evidence: z.array(evidenceSchema).max(20).optional(),
    status: z.literal("pending"),
    createdAt: z.string().datetime(),
  }),
  "proposal.resolved": z.object({
    id: uuid,
    decision: z.enum(["accept", "reject"]),
    content: stateContentSchema.optional(),
  }),
  "inbox.observed": batchSchema,
  "inbox.conflict": batchSchema.extend({ status: z.literal("conflict") }),
  "inbox.cleared": z.object({ id: uuid }),
  "usage.recorded": usageSchema,
  "usage.reserved": usageSchema,
  "usage.released": z.object({ id: uuid }),
  "library.migrated": z.object({ version: z.literal(2) }),
  "structure.added": structureInputSchema.extend({
    id: uuid,
    fingerprint: z.string().length(64),
    bases: basesSchema,
    status: z.literal("pending"),
    createdAt: z.string().datetime(),
  }),
  "structure.amended": structureInputSchema.extend({
    id: uuid,
    fingerprint: z.string().length(64),
    bases: basesSchema,
    status: z.literal("pending"),
    createdAt: z.string().datetime(),
  }),
  "structure.resolved": z.object({
    id: uuid,
    decision: z.enum(["accept", "reject", "defer"]),
    targetId: uuid.optional(),
    createdId: uuid.optional(),
  }),
  "structure.undone": z.object({ id: uuid }),
  "task.added": taskSchema,
  "task.updated": z.object({
    id: uuid,
    status: z.enum(["pending", "running", "done", "failed", "budget"]),
    error: z.string().max(1000).nullable().optional(),
    input: z.string().max(32000).optional(),
    inputVersions: z.array(evidenceSchema).max(30).optional(),
    budgetDay: z.string().optional(),
    result: z.unknown().optional(),
  }),
  "recap.added": z.object({
    id: uuid,
    threadId: uuid,
    createdAt: z.string().datetime(),
    start: z.string().datetime(),
    end: z.string().datetime(),
    total: natural,
    sampled: natural,
    baseVersion: natural,
    evidence: z.array(evidenceSchema).max(30),
    expressed: z.string().max(3000),
    possible: z.string().max(3000),
    questions: z.string().max(2000),
  }),
};
export function validateEvent(input: unknown): ThoughtEvent {
  const e = eventSchema.parse(input);
  return { ...e, payload: schemas[e.type].parse(e.payload) };
}
type Kind =
  | "notes"
  | "threads"
  | "cognitions"
  | "proposals"
  | "batches"
  | "usage"
  | "reservations"
  | "structures"
  | "tasks"
  | "recaps"
  | "revisions"
  | "cognitionHistory";

/** Canonical append-only events plus disposable, transactionally updated SQL projections. */
export class Store {
  private db: DatabaseSync;
  readonly path: string;
  onCommitted?: () => void;
  constructor(path: string) {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS events_note_completion ON events(json_extract(body,'$.payload.id'),json_extract(body,'$.type'),seq);
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS entities_v2(kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,seq INTEGER NOT NULL,createdAt TEXT NOT NULL,PRIMARY KEY(kind,id));
   CREATE INDEX IF NOT EXISTS entities_v2_seq ON entities_v2(kind,seq);
   CREATE TABLE IF NOT EXISTS note_query_v2(id TEXT PRIMARY KEY,seq INTEGER NOT NULL,threadId TEXT,parentNoteId TEXT,createdAt TEXT NOT NULL,status TEXT NOT NULL,legacy INTEGER NOT NULL,raw TEXT NOT NULL,title TEXT NOT NULL,synopsis TEXT NOT NULL,reply TEXT NOT NULL,summary TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS note_query_v2_thread ON note_query_v2(threadId,seq);
   CREATE INDEX IF NOT EXISTS note_query_v2_parent ON note_query_v2(parentNoteId,seq);
   CREATE INDEX IF NOT EXISTS note_query_v2_status ON note_query_v2(status,seq);
   CREATE INDEX IF NOT EXISTS note_query_v2_date ON note_query_v2(createdAt,seq);
   CREATE TABLE IF NOT EXISTS task_notes_v2(taskId TEXT NOT NULL,noteId TEXT NOT NULL,PRIMARY KEY(taskId,noteId));
   CREATE INDEX IF NOT EXISTS task_notes_v2_note ON task_notes_v2(noteId);
   CREATE VIRTUAL TABLE IF NOT EXISTS search_v2 USING fts5(id UNINDEXED,raw,title,synopsis,reply,tokenize='trigram');`);
    if (
      !this.db
        .prepare("PRAGMA table_info(entities_v2)")
        .all()
        .some((r) => r.name === "createdAt")
    )
      this.db.exec(
        "ALTER TABLE entities_v2 ADD COLUMN createdAt TEXT NOT NULL DEFAULT ''",
      );
    if (
      !this.db
        .prepare("PRAGMA table_info(note_query_v2)")
        .all()
        .some((r) => r.name === "summary")
    )
      this.db.exec(
        "ALTER TABLE note_query_v2 ADD COLUMN summary TEXT NOT NULL DEFAULT ''",
      );
    if (
      this.getMeta("projectionVersion") !== "2.6" ||
      Number(this.getMeta("projectedSeq") ?? -1) !== this.latestSeq() ||
      Number(this.getMeta("projectionNoteCount") ?? 0) !==
        Number(
          this.db.prepare("SELECT COUNT(*) n FROM note_query_v2").get()?.n,
        ) ||
      Number(
        this.db
          .prepare("SELECT COUNT(*) n FROM entities_v2 WHERE kind='notes'")
          .get()?.n,
      ) !==
        Number(this.db.prepare("SELECT COUNT(*) n FROM search_v2").get()?.n) ||
      !!this.db
        .prepare(
          "SELECT 1 FROM note_query_v2 WHERE NOT json_valid(summary) LIMIT 1",
        )
        .get()
    )
      this.rebuild();
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS entity_dates_v2 ON entities_v2(kind,createdAt,seq); CREATE INDEX IF NOT EXISTS task_queue_v2 ON entities_v2(kind,json_extract(body,'$.status'),json_extract(body,'$.kind'),seq) WHERE kind='tasks'; CREATE INDEX IF NOT EXISTS usage_dates_v2 ON entities_v2(kind,json_extract(body,'$.createdAt')) WHERE kind IN ('usage','reservations');",
    );
    if (!this.getMeta("deviceId")) this.setMeta("deviceId", randomUUID());
  }
  close() {
    this.db.close();
  }
  dataReport(before?: number) {
    const rows = this.db
      .prepare(
        "SELECT seq,id,json_extract(body,'$.status') status,json_extract(body,'$.createdAt') createdAt,json_array_length(body,'$.items') count FROM entities_v2 WHERE kind='batches' AND seq<? ORDER BY seq DESC LIMIT 11",
      )
      .all(before ?? this.latestSeq() + 1);
    const since = new Date(
      new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) +
        "T00:00:00+08:00",
    ).toISOString();
    const usage = this.db
      .prepare(
        "SELECT COALESCE(SUM(json_extract(body,'$.input')),0) input,COALESCE(SUM(json_extract(body,'$.output')),0) output FROM entities_v2 WHERE kind='usage' AND json_extract(body,'$.createdAt')>=?",
      )
      .get(since)!;
    const unknown = Number(
      this.db
        .prepare("SELECT COUNT(*) n FROM entities_v2 WHERE kind='reservations'")
        .get()?.n ?? 0,
    );
    return {
      batches: rows.slice(0, 10).map((r) => ({
        seq: Number(r.seq),
        id: String(r.id),
        status: String(r.status),
        createdAt: String(r.createdAt),
        count: Number(r.count),
      })),
      before: rows.length > 10 ? Number(rows[9].seq) : null,
      usage: {
        input: Number(usage.input),
        output: Number(usage.output),
        unknown,
      },
    };
  }
  importDetail(id: string): InboxBatch {
    const b = this.get<InboxBatch>("batches", id);
    if (!b) throw new Error("导入凭据不存在");
    return b;
  }
  getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return r ? String(r.value) : null;
  }
  setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  private get<T>(kind: Kind, id: string): T | null {
    const r = this.db
      .prepare("SELECT body FROM entities_v2 WHERE kind=? AND id=?")
      .get(kind, id);
    return r ? JSON.parse(String(r.body)) : null;
  }
  latest<T>(kind: Kind, limit = 30): T[] {
    return this.db
      .prepare(
        "SELECT body FROM entities_v2 WHERE kind=? ORDER BY seq DESC LIMIT ?",
      )
      .all(kind, limit)
      .map((r) => JSON.parse(String(r.body)))
      .reverse();
  }
  activeBatches(): InboxBatch[] {
    return this.db
      .prepare(
        "SELECT body FROM entities_v2 WHERE kind='batches' AND json_extract(body,'$.status')='pending' ORDER BY seq",
      )
      .all()
      .map((r) => JSON.parse(String(r.body)));
  }
  all<T>(kind: Kind): T[] {
    return this.db
      .prepare("SELECT body FROM entities_v2 WHERE kind=? ORDER BY seq,id")
      .all(kind)
      .map((r) => JSON.parse(String(r.body)));
  }
  private put(kind: Kind, id: string, value: any, seq: number) {
    const previous = kind === "notes" ? this.get<Note>("notes", id) : null;
    if (kind === "notes") {
      this.setMeta(
        "noteVersion:" + id,
        String(Number(this.getMeta("noteVersion:" + id) ?? 0) + 1),
      );
      if (previous?.threadId)
        this.setMeta(
          "activity:" + previous.threadId,
          String(
            Number(this.getMeta("activity:" + previous.threadId) ?? 0) + 1,
          ),
        );
      if (value.threadId)
        this.setMeta(
          "activity:" + value.threadId,
          String(Number(this.getMeta("activity:" + value.threadId) ?? 0) + 1),
        );
    }
    if (kind === "threads" || kind === "cognitions")
      this.setMeta(
        "activity:" + (value.threadId ?? id),
        String(
          Number(this.getMeta("activity:" + (value.threadId ?? id)) ?? 0) + 1,
        ),
      );
    this.db
      .prepare(
        "INSERT INTO entities_v2 VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
      )
      .run(kind, id, JSON.stringify(value), seq, value.createdAt ?? "");
    if (kind !== "notes") return;
    const n = value as Note,
      raw =
        n.raw +
        (n.currentRaw && n.currentRaw !== n.raw ? "\n" + n.currentRaw : "");
    const summary = {
      ...n,
      raw: [...(n.currentRaw ?? n.raw)]
        .slice(0, isShortNote(n.currentRaw ?? n.raw) ? 120 : 180)
        .join(""),
      reply: null,
      previewKind: isShortNote(n.currentRaw ?? n.raw) ? "original" : "synopsis",
    };
    delete summary.currentRaw;
    delete summary.processing;
    this.db
      .prepare(
        `INSERT INTO note_query_v2 VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET threadId=excluded.threadId,parentNoteId=excluded.parentNoteId,status=excluded.status,legacy=excluded.legacy,raw=excluded.raw,title=excluded.title,synopsis=excluded.synopsis,reply=excluded.reply,summary=excluded.summary`,
      )
      .run(
        id,
        seq,
        n.threadId,
        n.parentNoteId ?? null,
        n.createdAt,
        n.status,
        n.legacy ? 1 : 0,
        raw,
        n.title,
        n.synopsis,
        n.reply ?? "",
        JSON.stringify(summary),
      );
    this.db.prepare("DELETE FROM search_v2 WHERE id=?").run(id);
    this.db
      .prepare("INSERT INTO search_v2 VALUES(?,?,?,?,?)")
      .run(id, raw, n.title, n.synopsis, n.reply ?? "");
  }
  private del(kind: Kind, id: string) {
    this.db
      .prepare("DELETE FROM entities_v2 WHERE kind=? AND id=?")
      .run(kind, id);
  }
  note(id: string): Note {
    const n = this.get<Note>("notes", id);
    if (!n) throw new Error("记录不存在");
    return n;
  }
  threads(): Thread[] {
    return this.all("threads");
  }
  private requireThread(id: string, active = false): Thread {
    const t = this.get<Thread>("threads", id);
    if (!t) throw new Error("思考线程不存在");
    if (active && t.archived) throw new Error("历史线程不能接收新记录");
    return t;
  }
  private validateParent(id: string, parentId: string | null) {
    if (!parentId) return;
    const p = this.requireThread(parentId, true);
    if (
      id === parentId ||
      p.parentId ||
      this.threads().some((t) => t.parentId === id && !t.archived)
    )
      throw new Error("线程最多两层，不能循环或把有子问题的主问题降级");
  }
  private verifyEvidence(refs: Evidence[]) {
    for (const r of refs) this.revision(r.noteId, r.revision);
  }
  private apply(e: ThoughtEvent, seq: number) {
    const p = e.payload as any,
      save = (n: Note) => this.put("notes", n.id, n, seq);
    switch (e.type) {
      case "note.added": {
        if (this.get("notes", p.id)) throw new Error("记录 ID 重复");
        if (p.threadId) this.requireThread(p.threadId);
        if (p.parentNoteId) {
          const parent = this.note(p.parentNoteId);
          if (p.mode !== "discussion" || parent.parentNoteId)
            throw new Error("讨论须关联起始笔记，不能嵌套");
          this.revision(parent.id, p.parentRevision ?? 0);
          if (parent.threadId !== p.threadId)
            throw new Error("讨论与起始笔记须属于同一线程");
        }
        const n: Note = {
          ...p,
          revision: p.revision ?? 0,
          assignmentRevision: p.assignmentRevision ?? 0,
          parentNoteId: p.parentNoteId ?? null,
          legacy: p.legacy ?? p.revision === undefined,
        };
        save(n);
        this.setMeta(
          "projectionNoteCount",
          String(Number(this.getMeta("projectionNoteCount") ?? 0) + 1),
        );
        this.put(
          "revisions",
          n.id + ":0",
          {
            id: e.id,
            noteId: n.id,
            revision: 0,
            raw: n.raw,
            createdAt: n.createdAt,
          },
          seq,
        );
        break;
      }
      case "thread.added":
        if (this.get("threads", p.id)) throw new Error("线程 ID 重复");
        this.validateParent(p.id, p.parentId ?? null);
        this.put(
          "threads",
          p.id,
          {
            ...p,
            parentId: p.parentId ?? null,
            description: p.description ?? "",
            archived: p.archived ?? false,
            revision: p.revision ?? 0,
          },
          seq,
        );
        break;
      case "thread.updated": {
        const t = this.requireThread(p.id);
        this.validateParent(p.id, p.parentId);
        if (
          p.archived &&
          this.threads().some((x) => x.parentId === p.id && !x.archived)
        )
          throw new Error("请先归档子问题");
        this.put(
          "threads",
          t.id,
          { ...t, ...p, revision: (t.revision ?? 0) + 1 },
          seq,
        );
        break;
      }
      case "note.started":
      case "note.failed":
      case "note.retried": {
        const n = this.note(p.id);
        if (e.type === "note.retried" && n.status !== "failed")
          throw new Error("只有失败的记录可以重试");
        n.status =
          e.type === "note.started"
            ? "running"
            : e.type === "note.failed"
              ? "failed"
              : "pending";
        if (e.type === "note.retried") n.legacy = false;
        n.error = p.error ?? null;
        if (e.type === "note.started" && p.input)
          n.processing = {
            input: p.input,
            versions: p.inputVersions ?? [],
            revision: p.inputRevision ?? n.revision ?? 0,
          };
        save(n);
        break;
      }
      case "note.completed": {
        const n = this.note(p.id);
        if (p.threadId) this.requireThread(p.threadId);
        if (n.mode === "note" && p.result.reply.length > 150)
          throw new Error("自动回应超过长度限制");
        if (p.inputRevision !== undefined && p.inputRevision !== n.revision)
          throw new Error("原文已经更正，请重新处理");
        if (!n.titleLocked) n.title = p.result.title;
        n.synopsis =
          p.inputRevision === undefined
            ? p.result.synopsis
            : isShortNote(n.currentRaw ?? n.raw)
              ? ""
              : p.result.synopsis;
        n.reply = p.result.reply;
        if (n.processing && p.usage) n.processing.usage = p.usage;
        if (n.parentNoteId) n.threadId = this.note(n.parentNoteId).threadId;
        else if (!n.assignmentLocked) n.threadId = p.threadId;
        n.status = "done";
        n.error = null;
        save(n);
        break;
      }
      case "note.moved": {
        if (p.threadId) this.requireThread(p.threadId, true);
        for (const id of this.withDiscussions([
          this.note(p.id).parentNoteId ?? p.id,
        ])) {
          const n = this.note(id);
          n.threadId = p.threadId;
          n.assignmentRevision = (n.assignmentRevision ?? 0) + 1;
          n.assignmentLocked = true;
          save(n);
        }
        break;
      }
      case "note.corrected": {
        const n = this.note(p.id);
        n.revision = (n.revision ?? 0) + 1;
        n.currentRaw = p.raw;
        n.synopsis = "待生成";
        n.reply = null;
        n.status = "pending";
        n.error = null;
        save(n);
        this.put(
          "revisions",
          n.id + ":" + n.revision,
          {
            id: e.id,
            noteId: n.id,
            revision: n.revision,
            raw: p.raw,
            createdAt: e.createdAt,
          },
          seq,
        );
        break;
      }
      case "note.titled": {
        const n = this.note(p.id);
        n.title = p.title;
        n.titleLocked = true;
        save(n);
        break;
      }
      case "library.migrated": {
        if (this.getMeta("migrationV2"))
          throw new Error("资料库已完成升级整理");
        for (const t of this.threads())
          this.put(
            "threads",
            t.id,
            { ...t, archived: true, revision: (t.revision ?? 0) + 1 },
            seq,
          );
        for (const n of this.all<Note>("notes")) {
          n.originalThreadId = n.threadId;
          n.threadId = null;
          n.legacy = true;
          n.assignmentRevision = (n.assignmentRevision ?? 0) + 1;
          if (n.status === "pending") {
            n.status = "failed";
            n.error =
              "升级时暂缓旧版未完成的 AI 处理；原文与已有派生内容保留，可手动重试。";
          }
          save(n);
        }
        this.setMeta("migrationV2", e.id);
        break;
      }
      case "proposal.added": {
        this.requireThread(p.threadId);
        if (this.get("proposals", p.id)) throw new Error("建议 ID 重复");
        if (this.cognition(p.threadId).version !== p.baseVersion)
          throw new Error("当前认知已经变化，请重新生成建议");
        const refs =
          p.evidence ??
          p.evidenceIds.map((id: string) => ({ noteId: id, revision: 0 }));
        this.verifyEvidence(refs);
        this.put("proposals", p.id, { ...p, evidence: refs }, seq);
        break;
      }
      case "proposal.resolved": {
        const v = this.get<Proposal>("proposals", p.id);
        if (!v || v.status !== "pending") throw new Error("建议已处理或不存在");
        if (p.decision === "accept") {
          if (this.cognition(v.threadId).version !== v.baseVersion)
            throw new Error("这份建议已过期，请重新生成");
          this.requireThread(v.threadId, true);
          const c = {
            ...(p.content ?? v.after),
            threadId: v.threadId,
            version: v.baseVersion + 1,
          };
          this.put("cognitions", v.threadId, c, seq);
          this.put("cognitionHistory", v.threadId + ":" + c.version, c, seq);
          v.acceptedContent = p.content ?? v.after;
        }
        v.status = p.decision === "accept" ? "accepted" : "rejected";
        this.put("proposals", v.id, v, seq);
        break;
      }
      case "inbox.observed":
      case "inbox.conflict":
        if (this.get("batches", p.id)) throw new Error("导入批次重复");
        this.put("batches", p.id, p, seq);
        break;
      case "inbox.cleared": {
        const b = this.get<InboxBatch>("batches", p.id);
        if (!b) throw new Error("导入批次不存在");
        b.status = "cleared";
        this.put("batches", b.id, b, seq);
        break;
      }
      case "usage.reserved":
        this.put("reservations", p.id, p, seq);
        break;
      case "usage.released":
        this.del("reservations", p.id);
        break;
      case "usage.recorded":
        this.put("usage", p.id, p, seq);
        this.del("reservations", p.id);
        break;
      case "structure.amended": {
        const old = this.get<StructureProposal>("structures", p.id);
        if (!old || old.status !== "pending")
          throw new Error("整理建议不能追加依据");
        this.checkBases(old.bases);
        this.verifyEvidence(p.evidence);
        this.checkBases(p.bases);
        this.put("structures", p.id, p, seq);
        break;
      }
      case "structure.added":
        this.verifyEvidence(p.evidence);
        this.checkBases(p.bases);
        if (this.get("structures", p.id)) throw new Error("整理建议重复");
        this.put("structures", p.id, p, seq);
        break;
      case "structure.resolved":
        this.applyStructure(p, seq, e.createdAt);
        break;
      case "structure.undone":
        this.undoStructure(p.id, seq);
        break;
      case "task.added":
        if (this.get("tasks", p.id)) throw new Error("任务重复");
        for (const id of p.noteIds) this.note(id);
        if (p.threadId) this.requireThread(p.threadId, true);
        this.put("tasks", p.id, p, seq);
        for (const id of p.noteIds)
          this.db
            .prepare("INSERT INTO task_notes_v2 VALUES(?,?)")
            .run(p.id, id);
        break;
      case "task.updated": {
        const t = this.get<AiTask>("tasks", p.id);
        if (!t) throw new Error("任务不存在");
        this.put("tasks", p.id, { ...t, ...p }, seq);
        break;
      }
      case "recap.added":
        this.requireThread(p.threadId);
        this.verifyEvidence(p.evidence);
        this.put("recaps", p.id, p, seq);
        break;
    }
  }
  checkBases(b: StructureProposal["bases"]) {
    for (const [id, v] of Object.entries(b.raws ?? {}))
      if ((this.note(id).revision ?? 0) !== v)
        throw new Error("依据已更正，整理建议已过期");
    for (const [id, v] of Object.entries(b.threads))
      if ((this.requireThread(id).revision ?? 0) !== v)
        throw new Error("结构建议已过期，请重新生成");
    for (const [id, v] of Object.entries(b.notes))
      if ((this.note(id).assignmentRevision ?? 0) !== v)
        throw new Error("笔记归属已变化，整理建议已过期");
  }
  private applyStructure(p: any, seq: number, createdAt: string) {
    const s = this.get<StructureProposal>("structures", p.id);
    if (!s || s.status !== "pending") throw new Error("整理建议已处理或不存在");
    if (p.decision !== "accept") {
      s.status = p.decision === "reject" ? "rejected" : "deferred";
      this.put("structures", s.id, s, seq);
      return;
    }
    this.checkBases(s.bases);
    for (const r of s.evidence)
      if (this.note(r.noteId).revision !== r.revision)
        throw new Error("依据已更正，整理建议已过期");
    const threads = s.sourceIds.map((id) => this.requireThread(id));
    let dest: string | null = p.targetId ?? s.targetId;
    if (s.kind === "merge" && (!dest || !s.sourceIds.includes(dest)))
      throw new Error("请选择合并后的目标线程");
    if (s.kind === "create" && !p.targetId) {
      if (!p.createdId) throw new Error("缺少新线程标识");
      this.validateParent(p.createdId, s.parentId);
      if (
        this.threads().some(
          (t) =>
            !t.archived && t.parentId === s.parentId && t.title === s.title,
        )
      )
        throw new Error("同层已有同名线程，请核对建议");
      dest = p.createdId;
      this.put(
        "threads",
        dest!,
        {
          id: dest,
          title: s.title,
          description: s.description,
          parentId: s.parentId,
          archived: false,
          revision: 0,
          createdAt,
        },
        seq,
      );
    }
    if ((s.kind === "assign" || s.kind === "merge") && !dest)
      throw new Error("未指定目标线程");
    if (
      s.kind === "create" &&
      p.targetId &&
      !threads.some((t) => t.id === dest)
    )
      threads.push(this.requireThread(dest!, true));
    if (dest) this.requireThread(dest, true);
    const expected =
      s.kind === "merge"
        ? this.noteIdsForThreads(s.sourceIds)
        : this.withDiscussions(s.noteIds);
    if (
      expected.some((id) => !(id in s.bases.notes)) ||
      Object.keys(s.bases.notes).some((id) => !expected.includes(id))
    )
      throw new Error("关联内容已有变化，整理建议已过期");
    const ids =
      s.kind === "merge"
        ? this.noteIdsForThreads(s.sourceIds.filter((id) => id !== dest))
        : expected;
    const u: NonNullable<StructureProposal["undo"]> = {
      threads,
      notes: ids.map((id) => {
        const n = this.note(id);
        return {
          id,
          threadId: n.threadId,
          assignmentRevision: n.assignmentRevision ?? 0,
          assignmentLocked: n.assignmentLocked,
        };
      }),
      after: {},
      createdId: s.kind === "create" && !p.targetId ? dest! : undefined,
    };
    if (s.kind === "reparent")
      for (const t of threads) {
        this.validateParent(t.id, s.parentId);
        this.put(
          "threads",
          t.id,
          { ...t, parentId: s.parentId, revision: (t.revision ?? 0) + 1 },
          seq,
        );
      }
    else {
      for (const id of ids) {
        const n = this.note(id);
        n.threadId = dest;
        n.assignmentRevision = (n.assignmentRevision ?? 0) + 1;
        n.assignmentLocked = true;
        this.put("notes", id, n, seq);
      }
      if (s.kind === "merge")
        for (const t of threads.filter((t) => t.id !== dest)) {
          if (this.threads().some((x) => x.parentId === t.id && !x.archived))
            throw new Error("请先整理来源线程的子问题");
          this.put(
            "threads",
            t.id,
            { ...t, archived: true, revision: (t.revision ?? 0) + 1 },
            seq,
          );
        }
    }
    for (const t of threads)
      u.after["t:" + t.id] = this.requireThread(t.id).revision ?? 0;
    if (u.createdId)
      u.after["t:" + u.createdId] =
        this.requireThread(u.createdId).revision ?? 0;
    for (const t of threads)
      u.after["a:" + t.id] = Number(this.getMeta("activity:" + t.id) ?? 0);
    for (const id of ids) {
      u.after["m:" + id] = Number(this.getMeta("noteVersion:" + id) ?? 0);
      u.after["n:" + id] = this.note(id).assignmentRevision ?? 0;
      u.after["r:" + id] = this.note(id).revision ?? 0;
    }
    if (s.kind !== "reparent") s.targetId = dest;
    s.status = "accepted";
    s.undo = u;
    this.put("structures", s.id, s, seq);
  }
  private undoStructure(id: string, seq: number) {
    const s = this.get<StructureProposal>("structures", id);
    if (!s || s.status !== "accepted" || !s.undo)
      throw new Error("没有可撤销的操作");
    const u = s.undo;
    for (const [key, v] of Object.entries(u.after)) {
      const [k, id] = key.split(":");
      const actual =
        k === "a"
          ? Number(this.getMeta("activity:" + id) ?? 0)
          : k === "m"
            ? Number(this.getMeta("noteVersion:" + id) ?? 0)
            : k === "t"
              ? this.requireThread(id).revision
              : k === "n"
                ? this.note(id).assignmentRevision
                : this.note(id).revision;
      if ((actual ?? 0) !== v)
        throw new Error("内容已有后续修改，无法直接撤销；请手动核对调整");
    }
    if (u.createdId) {
      const moved = new Set(u.notes.map((n) => n.id));
      if (
        this.noteIdsForThreads([u.createdId]).some((id) => !moved.has(id)) ||
        this.threads().some((t) => t.parentId === u.createdId && !t.archived) ||
        this.cognition(u.createdId).version
      )
        throw new Error("新线程已有后续内容，无法直接撤销");
    }
    for (const t of u.threads)
      this.put(
        "threads",
        t.id,
        { ...t, revision: (this.requireThread(t.id).revision ?? 0) + 1 },
        seq,
      );
    for (const before of u.notes) {
      const n = this.note(before.id);
      n.threadId = before.threadId;
      n.assignmentLocked = before.assignmentLocked;
      n.assignmentRevision = (n.assignmentRevision ?? 0) + 1;
      this.put("notes", n.id, n, seq);
    }
    if (u.createdId) {
      const t = this.requireThread(u.createdId);
      this.put(
        "threads",
        t.id,
        { ...t, archived: true, revision: (t.revision ?? 0) + 1 },
        seq,
      );
    }
    s.status = "undone";
    this.put("structures", s.id, s, seq);
  }
  private rebuild() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(
        "DELETE FROM entities_v2; DELETE FROM note_query_v2; DELETE FROM search_v2; DELETE FROM task_notes_v2;",
      );
      this.db
        .prepare(
          "DELETE FROM meta WHERE key='migrationV2' OR key='projectionNoteCount' OR key LIKE 'activity:%' OR key LIKE 'noteVersion:%'",
        )
        .run();
      for (const r of this.db
        .prepare("SELECT seq,body FROM events ORDER BY seq")
        .iterate())
        this.apply(validateEvent(JSON.parse(String(r.body))), Number(r.seq));
      this.setMeta("projectedSeq", String(this.latestSeq()));
      this.setMeta("projectionVersion", "2.6");
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  snapshot(): Snapshot {
    return {
      notes: this.all("notes"),
      threads: this.all("threads"),
      cognitions: this.all("cognitions"),
      proposals: this.all("proposals"),
      batches: this.all("batches"),
      usage: this.all("usage"),
      reservations: this.all("reservations"),
      structures: this.all("structures"),
      tasks: this.all("tasks"),
      recaps: this.all("recaps"),
    };
  }
  event(type: ThoughtEvent["type"], payload: unknown): ThoughtEvent {
    return validateEvent({
      id: randomUUID(),
      type,
      payload,
      createdAt: new Date().toISOString(),
    });
  }
  append(type: ThoughtEvent["type"], payload: unknown) {
    this.appendMany([this.event(type, payload)]);
  }
  appendMany(events: ThoughtEvent[]) {
    const seen = new Set<string>();
    const valid = events
      .filter(
        (e) =>
          !seen.has(e.id) &&
          !!seen.add(e.id) &&
          !this.db.prepare("SELECT 1 FROM events WHERE id=?").get(e.id),
      )
      .map(validateEvent);
    if (!valid.length) return;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.db.prepare("INSERT INTO events(id,body) VALUES(?,?)");
      for (const e of valid) {
        const r = insert.run(e.id, JSON.stringify(e));
        this.apply(e, Number(r.lastInsertRowid));
      }
      this.setMeta("projectedSeq", String(this.latestSeq()));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.onCommitted?.();
  }
  eventsAfter(seq = 0): { seq: number; event: ThoughtEvent }[] {
    return this.db
      .prepare("SELECT seq,body FROM events WHERE seq>? ORDER BY seq")
      .all(seq)
      .map((r) => ({
        seq: Number(r.seq),
        event: validateEvent(JSON.parse(String(r.body))),
      }));
  }
  latestSeq() {
    return Number(
      this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events").get()
        ?.seq ?? 0,
    );
  }
  migrateV2() {
    if (
      this.getMeta("migrationV2") ||
      !Number(
        this.db
          .prepare("SELECT COUNT(*) AS n FROM note_query_v2 WHERE legacy=1")
          .get()?.n,
      )
    )
      return;
    if (this.path !== ":memory:") {
      const folder = join(dirname(this.path), "backups");
      mkdirSync(folder, { recursive: true });
      const file = join(folder, "before-0.2.0-" + Date.now() + ".db");
      this.db.prepare("VACUUM INTO ?").run(file);
      this.setMeta("upgradeBackup", file);
    }
    this.setMeta(
      "upgradeAudit",
      JSON.stringify({
        path: this.path,
        deviceId: this.getMeta("deviceId"),
        notes: this.counts().notes,
        syncedSeq: Number(this.getMeta("syncedSeq") ?? 0),
        latest: this.latestSeq(),
        backup: this.getMeta("upgradeBackup"),
        at: new Date().toISOString(),
      }),
    );
    this.append("library.migrated", { version: 2 });
  }
  createNote(
    rawInput: unknown,
    source: Note["source"] = "desktop",
    id: string = randomUUID(),
  ): Note {
    const v = captureSchema.parse(rawInput);
    if (v.mode === "discussion" && !v.parentNoteId)
      throw new Error("请从一条笔记发起讨论");
    if (v.threadId) this.requireThread(v.threadId, true);
    return {
      id,
      raw: v.raw,
      title: [
        ...(v.raw.split(/\r\n|\r|\n/).find((s) => s.trim()) ?? "新想法").trim(),
      ]
        .slice(0, 24)
        .join(""),
      synopsis: "待生成",
      reply: null,
      threadId: v.threadId,
      createdAt: new Date().toISOString(),
      source,
      mode: v.mode,
      model: v.model,
      status: "pending",
      error: null,
      parentNoteId: v.parentNoteId,
      parentRevision: v.parentNoteId
        ? (v.parentRevision ?? this.note(v.parentNoteId).revision ?? 0)
        : undefined,
      revision: 0,
      assignmentRevision: 0,
      legacy: false,
    };
  }
  capture(input: unknown) {
    const n = this.createNote(input);
    this.append("note.added", n);
    return n.id;
  }
  cognition(threadId: string): Cognition {
    return (
      this.get("cognitions", threadId) ?? {
        ...emptyContent(),
        threadId,
        version: 0,
      }
    );
  }
  revision(id: string, revision: number): NoteRevision {
    const r = this.get<NoteRevision>("revisions", id + ":" + revision);
    if (!r) throw new Error("引用的原文版本不存在");
    return r;
  }
  detail(id: string) {
    return {
      note: this.note(id),
      revisions: this.db
        .prepare(
          "SELECT body FROM entities_v2 WHERE kind='revisions' AND json_extract(body,'$.noteId')=? ORDER BY seq",
        )
        .all(id)
        .map((r) => JSON.parse(String(r.body)) as NoteRevision),
      discussions: this.discussions(id),
    };
  }
  discussions(id: string, limit = 30, beforeId: string | null = null): Note[] {
    return this.db
      .prepare(
        "SELECT id FROM note_query_v2 WHERE parentNoteId=? AND (? IS NULL OR seq<(SELECT seq FROM note_query_v2 WHERE id=?)) ORDER BY seq DESC LIMIT ?",
      )
      .all(id, beforeId, beforeId, limit)
      .map((r) => this.note(String(r.id)))
      .reverse();
  }
  replyAtVersion(id: string, revision: number): string | null {
    const n = this.note(id);
    if ((n.revision ?? 0) === revision) return n.reply;
    const row = this.db
      .prepare(
        "SELECT body FROM events WHERE json_extract(body,'$.payload.id')=? AND json_extract(body,'$.type')='note.completed' AND coalesce(json_extract(body,'$.payload.inputRevision'),0)=? ORDER BY seq DESC LIMIT 1",
      )
      .get(id, revision);
    return row ? JSON.parse(String(row.body)).payload.result.reply : null;
  }
  counts() {
    return {
      notes: Number(
        this.db.prepare("SELECT COUNT(*) AS n FROM note_query_v2").get()?.n,
      ),
      unassigned: Number(
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM note_query_v2 WHERE threadId IS NULL",
          )
          .get()?.n,
      ),
      failed: Number(
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM note_query_v2 WHERE status='failed'",
          )
          .get()?.n,
      ),
      structures: Number(
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM entities_v2 WHERE kind='structures' AND json_extract(body,'$.status')='pending'",
          )
          .get()?.n,
      ),
    };
  }
  private withDiscussions(ids: string[]): string[] {
    if (!ids.length) return [];
    return this.db
      .prepare(
        `SELECT id FROM note_query_v2 WHERE id IN (${ids.map(() => "?").join(",")}) OR parentNoteId IN (${ids.map(() => "?").join(",")}) ORDER BY seq`,
      )
      .all(...ids, ...ids)
      .map((r) => String(r.id));
  }
  private noteIdsForThreads(ids: string[]): string[] {
    return ids.length
      ? this.db
          .prepare(
            `SELECT id FROM note_query_v2 WHERE threadId IN (${ids.map(() => "?").join(",")}) ORDER BY seq`,
          )
          .all(...ids)
          .map((r) => String(r.id))
      : [];
  }
  scopeThreadIds(id: string) {
    return [
      id,
      ...this.threads()
        .filter((t) => t.parentId === id && !t.archived)
        .map((t) => t.id),
    ];
  }
  private conditions(q: WorkspaceQuery) {
    const clauses = ["1=1"],
      args: (string | number)[] = [];
    if (q.workspace === "pending") clauses.push("threadId IS NULL");
    else if (!["all", "organize", "review", "history"].includes(q.workspace)) {
      const ids = this.scopeThreadIds(q.workspace);
      clauses.push(`threadId IN (${ids.map(() => "?").join(",")})`);
      args.push(...ids);
    }
    if (q.aiFilter === "failed") clauses.push("status='failed'");
    if (q.aiFilter === "pending")
      clauses.push("status IN ('pending','running')");
    const terms = q.query?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (terms.length) {
      const cols =
        q.searchIn === "reply" ? ["reply"] : ["raw", "title", "synopsis"];
      if (terms.every((t) => [...t].length >= 3)) {
        const match = terms
          .map((t) => `{${cols.join(" ")}} : "${t.replaceAll('"', '""')}"`)
          .join(" AND ");
        clauses.push(
          "id IN (SELECT id FROM search_v2 WHERE search_v2 MATCH ?)",
        );
        args.push(match);
      } else
        for (const t of terms) {
          const text = "%" + t.replace(/[\\%_]/g, "\\$&") + "%";
          clauses.push(`((${cols.join("||' '||")}) LIKE ? ESCAPE '\\')`);
          args.push(text);
        }
    }
    return { sql: clauses.join(" AND "), args };
  }
  workspace(q: WorkspaceQuery): WorkspacePage {
    const c = this.conditions(q),
      cut =
        q.before ??
        (q.date
          ? Number(
              this.db
                .prepare(
                  "SELECT COALESCE(MAX(seq),0)+1 AS n FROM entities_v2 WHERE kind IN ('notes','structures','proposals','recaps') AND createdAt<=?",
                )
                .get(new Date(q.date + "T23:59:59.999+08:00").toISOString())?.n,
            )
          : this.latestSeq() + 1);
    const special =
      q.workspace === "organize"
        ? "structures"
        : q.workspace === "review"
          ? "recaps"
          : null;
    const notes = `SELECT seq,'note' AS kind,id FROM note_query_v2 WHERE ${c.sql}`;
    let select: string, args: (string | number)[];
    if (special) {
      select =
        "SELECT seq,CASE kind WHEN 'structures' THEN 'structure' ELSE 'recap' END AS kind,id FROM entities_v2 WHERE kind=?";
      args = [special];
    } else if (q.workspace === "history") {
      select =
        "SELECT seq,'note' AS kind,id FROM entities_v2 WHERE kind='notes' AND json_extract(body,'$.originalThreadId') IS NOT NULL";
      args = [];
    } else if (q.workspace === "pending") {
      select = notes;
      args = c.args;
    } else if (!q.query && (!q.aiFilter || q.aiFilter === "all")) {
      const filter = !["all", "pending"].includes(q.workspace)
        ? " AND json_extract(body,'$.threadId')=?"
        : "";
      select =
        notes +
        " UNION ALL SELECT seq,'proposal',id FROM entities_v2 WHERE kind='proposals'" +
        filter;
      args = [...c.args, ...(filter ? [q.workspace] : [])];
      if (q.workspace === "all") {
        select +=
          " UNION ALL SELECT seq,'structure',id FROM entities_v2 WHERE kind='structures'";
      } else {
        select +=
          " UNION ALL SELECT seq,'recap',id FROM entities_v2 WHERE kind='recaps' AND json_extract(body,'$.threadId')=?";
        args.push(q.workspace);
      }
    } else {
      select = notes;
      args = c.args;
    }
    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n FROM (${select})`).get(...args)
        ?.n ?? 0,
    );
    const rows = this.db
        .prepare(
          `SELECT * FROM (${select}) WHERE seq<? ORDER BY seq DESC LIMIT 31`,
        )
        .all(...args, cut),
      visible = rows.slice(0, 30).reverse();
    const items = visible.map((r) => {
      const kind = String(r.kind) as
          "note" | "structure" | "proposal" | "recap",
        bucket =
          kind === "note"
            ? "notes"
            : kind === "structure"
              ? "structures"
              : kind === "proposal"
                ? "proposals"
                : "recaps",
        value =
          kind === "note"
            ? JSON.parse(
                String(
                  this.db
                    .prepare("SELECT summary FROM note_query_v2 WHERE id=?")
                    .get(String(r.id))!.summary,
                ),
              )
            : this.get<any>(bucket, String(r.id));
      return { seq: Number(r.seq), kind, value };
    });
    const newer =
      q.before || q.date
        ? this.db
            .prepare(
              `SELECT seq FROM (${select}) WHERE seq>=? ORDER BY seq LIMIT 30`,
            )
            .all(...args, cut)
        : [];
    return {
      items,
      newerBefore: newer.length ? Number(newer.at(-1)!.seq) + 1 : null,
      before: rows.length > 30 ? Number(visible[0].seq) : null,
      latest: this.latestSeq(),
      total,
    };
  }
  search(query: string, includeReply = true): Note[] {
    if (!query.trim()) return this.recent(null, 500);
    if (includeReply) {
      const terms = query.trim().split(/\s+/);
      return this.db
        .prepare(
          "SELECT id FROM note_query_v2 WHERE " +
            terms
              .map(
                () =>
                  "(raw||' '||title||' '||synopsis||' '||reply) LIKE ? ESCAPE '\\'",
              )
              .join(" AND ") +
            " ORDER BY seq DESC LIMIT 500",
        )
        .all(...terms.map((t) => "%" + t.replace(/[\\%_]/g, "\\$&") + "%"))
        .map((r) => this.note(String(r.id)));
    }
    const c = this.conditions({
      workspace: "all",
      query,
      searchIn: "original",
    });
    return this.db
      .prepare(
        `SELECT id FROM note_query_v2 WHERE ${c.sql} ORDER BY seq DESC LIMIT 30`,
      )
      .all(...c.args)
      .map((r) => this.note(String(r.id)));
  }
  recent(threadId: string | null, limit = 10): Note[] {
    const ids = threadId ? this.scopeThreadIds(threadId) : [];
    return this.db
      .prepare(
        "SELECT id FROM note_query_v2" +
          (ids.length
            ? ` WHERE threadId IN (${ids.map(() => "?").join(",")})`
            : "") +
          " ORDER BY seq DESC LIMIT ?",
      )
      .all(...ids, limit)
      .map((r) => this.note(String(r.id)));
  }
  nextNote(): Note | null {
    const r = this.db
      .prepare(
        "SELECT id FROM note_query_v2 WHERE status='pending' ORDER BY seq LIMIT 1",
      )
      .get();
    return r ? this.note(String(r.id)) : null;
  }
  private forThread<T>(kind: Kind, id: string | null, limit: number): T[] {
    return this.db
      .prepare(
        "SELECT body FROM entities_v2 WHERE kind=? AND json_extract(body,'$.threadId')=? ORDER BY seq DESC LIMIT ?",
      )
      .all(kind, id, limit)
      .map((r) => JSON.parse(String(r.body)))
      .reverse();
  }
  resources(id: string | null): ThreadResources {
    const thread = id ? this.requireThread(id) : null,
      recaps = this.forThread<Recap>("recaps", id, 10).reverse(),
      last = recaps[0],
      latest = id ? this.recent(id, 1)[0] : null,
      scope = id ? this.scopeThreadIds(id) : [];
    return {
      thread,
      cognition: this.cognition(id ?? ""),
      proposals: this.forThread<Proposal>("proposals", id, 30),
      recaps,
      cognitionHistory: this.forThread<Cognition>("cognitionHistory", id, 30),
      legacyThreads: this.threads().filter((t) => t.archived),
      count: scope.length
        ? Number(
            this.db
              .prepare(
                `SELECT COUNT(*) AS n FROM note_query_v2 WHERE threadId IN (${scope.map(() => "?").join(",")})`,
              )
              .get(...scope)!.n,
          )
        : 0,
      recapDue:
        !!latest &&
        (!last || latest.createdAt > last.end) &&
        Date.now() - Date.parse(last?.createdAt ?? thread!.createdAt) >=
          7 * 86400000,
    };
  }
  workspaceState(key: string, value?: WorkspaceState): WorkspaceState {
    if (value) this.setMeta("workspace:" + key, JSON.stringify(value));
    return JSON.parse(
      this.getMeta("workspace:" + key) ??
        '{"draft":"","mode":"note","parentNoteId":null,"openIds":[]}',
    );
  }
  preferences(value?: Record<string, number | boolean | string>) {
    if (value) this.setMeta("preferences", JSON.stringify(value));
    return JSON.parse(this.getMeta("preferences") ?? "{}");
  }
  thread(input: {
    id?: string;
    title: string;
    description: string;
    parentId: string | null;
    archived?: boolean;
  }) {
    const id = input.id ?? randomUUID();
    if (input.id)
      this.append("thread.updated", {
        ...input,
        id,
        archived: input.archived ?? this.requireThread(id).archived ?? false,
      });
    else
      this.append("thread.added", {
        ...input,
        id,
        archived: false,
        createdAt: new Date().toISOString(),
      });
    return id;
  }
  prepareStructure(input: unknown): ThoughtEvent | null {
    let p = structureInputSchema.parse(input);
    let amend: StructureProposal | null = null;
    if (p.kind === "create") {
      const row = this.db
        .prepare(
          "SELECT body FROM entities_v2 WHERE kind='structures' AND json_extract(body,'$.status')='pending' AND json_extract(body,'$.kind')='create' AND json_extract(body,'$.title')=? AND json_extract(body,'$.parentId') IS ? ORDER BY seq DESC LIMIT 1",
        )
        .get(p.title, p.parentId);
      if (row) {
        const candidate = JSON.parse(String(row.body)) as StructureProposal;
        try {
          this.checkBases(candidate.bases);
          for (const r of candidate.evidence)
            if (this.note(r.noteId).revision !== r.revision)
              throw new Error("stale");
          amend = candidate;
        } catch {
          /* Keep stale proposals separate for explicit review. */
        }
      }
      if (amend)
        p = {
          ...p,
          noteIds: [...new Set([...amend.noteIds, ...p.noteIds])],
          evidence: [
            ...new Map(
              [...amend.evidence, ...p.evidence].map((r) => [r.noteId, r]),
            ).values(),
          ].slice(-30),
        };
    }
    this.verifyEvidence(p.evidence);
    if (p.kind === "assign" && (!p.targetId || !p.noteIds.length))
      throw new Error("归类建议缺少目标或笔记");
    if (["merge", "reparent"].includes(p.kind) && !p.sourceIds.length)
      throw new Error("结构建议缺少来源线程");
    if (p.kind === "merge" && p.sourceIds.length < 2)
      throw new Error("合并至少需要两个线程");
    const sources = [
      ...new Set([
        ...p.sourceIds,
        ...(p.targetId ? [p.targetId] : []),
        ...(p.parentId ? [p.parentId] : []),
      ]),
    ];
    for (const id of sources) this.requireThread(id, true);
    const affected =
      p.kind === "merge"
        ? this.noteIdsForThreads(p.sourceIds)
        : this.withDiscussions(p.noteIds);
    const bases = {
      raws: Object.fromEntries(
        affected.map((id) => [id, this.note(id).revision ?? 0]),
      ),
      threads: Object.fromEntries(
        sources.map((id) => [id, this.requireThread(id).revision ?? 0]),
      ),
      notes: Object.fromEntries(
        affected.map((id) => [id, this.note(id).assignmentRevision ?? 0]),
      ),
    };
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          kind: p.kind,
          parent: p.parentId,
          target: p.targetId,
          sources: [...p.sourceIds].sort(),
          notes: [...p.noteIds].sort(),
          evidence: [...p.evidence].sort((a, b) =>
            a.noteId.localeCompare(b.noteId),
          ),
        }),
      )
      .digest("hex");
    if (
      this.db
        .prepare(
          "SELECT 1 FROM entities_v2 WHERE kind='structures' AND json_extract(body,'$.fingerprint')=? AND json_extract(body,'$.status')!='undone'",
        )
        .get(fingerprint)
    )
      return null;
    return this.event(amend ? "structure.amended" : "structure.added", {
      ...p,
      id: amend?.id ?? randomUUID(),
      fingerprint,
      bases,
      status: "pending",
      createdAt: amend?.createdAt ?? new Date().toISOString(),
    });
  }
  addStructure(input: unknown): string | null {
    const e = this.prepareStructure(input);
    if (!e) return null;
    this.appendMany([e]);
    return (e.payload as { id: string }).id;
  }
  resolveStructures(
    ids: string[],
    decision: "accept" | "reject" | "defer",
    targetId?: string,
    targets?: Record<string, string>,
  ) {
    this.appendMany(
      ids.map((id) =>
        this.event("structure.resolved", {
          id,
          decision,
          targetId: targets?.[id] ?? targetId,
          createdId: decision === "accept" ? randomUUID() : undefined,
        }),
      ),
    );
  }
  structure(id: string): StructureProposal {
    const s = this.get<StructureProposal>("structures", id);
    if (!s) throw new Error("整理建议不存在");
    return s;
  }
  nextTask(kind: "interactive" | "organize", day: string): AiTask | null {
    const r = this.db
      .prepare(
        "SELECT body FROM entities_v2 WHERE kind='tasks' AND " +
          (kind === "organize"
            ? "json_extract(body,'$.kind')='organize'"
            : "json_extract(body,'$.kind')!='organize'") +
          " AND (json_extract(body,'$.status')='pending' OR (json_extract(body,'$.status')='budget' AND json_extract(body,'$.budgetDay')!=?)) ORDER BY seq LIMIT 1",
      )
      .get(day);
    return r ? JSON.parse(String(r.body)) : null;
  }
  task(id: string): AiTask {
    const t = this.get<AiTask>("tasks", id);
    if (!t) throw new Error("任务不存在");
    return t;
  }
  tasks(): AiTask[] {
    return this.all("tasks");
  }
  addTask(
    kind: AiTask["kind"],
    threadId: string | null,
    model: Note["model"],
    noteIds: string[] = [],
  ) {
    const existing = this.db
      .prepare(
        "SELECT id FROM entities_v2 WHERE kind='tasks' AND json_extract(body,'$.kind')=? AND json_extract(body,'$.threadId') IS ? AND json_extract(body,'$.model')=? AND json_extract(body,'$.noteIds')=? AND json_extract(body,'$.status') IN ('pending','running','budget') LIMIT 1",
      )
      .get(kind, threadId, model, JSON.stringify(noteIds));
    if (existing) return String(existing.id);
    const id = randomUUID();
    this.append("task.added", {
      id,
      kind,
      threadId,
      model,
      noteIds,
      status: "pending",
      error: null,
      createdAt: new Date().toISOString(),
    });
    return id;
  }
  organizeCandidates(): Note[] {
    return this.db
      .prepare(
        "SELECT n.id FROM note_query_v2 n WHERE legacy=1 AND threadId IS NULL AND parentNoteId IS NULL AND NOT EXISTS(SELECT 1 FROM task_notes_v2 t JOIN entities_v2 e ON e.kind='tasks' AND e.id=t.taskId WHERE t.noteId=n.id AND json_extract(e.body,'$.kind')='organize') ORDER BY seq LIMIT 10",
      )
      .all()
      .map((r) => this.note(String(r.id)));
  }
  dailyUsage(day: string) {
    const start = new Date(day + "T00:00:00+08:00").toISOString(),
      end = new Date(Date.parse(start) + 86400000).toISOString();
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(json_extract(body,'$.input')),0) input,COALESCE(SUM(json_extract(body,'$.output')),0) output FROM entities_v2 WHERE kind IN ('usage','reservations') AND json_extract(body,'$.createdAt')>=? AND json_extract(body,'$.createdAt')<?",
      )
      .get(start, end)!;
    return { input: Number(row.input), output: Number(row.output) };
  }
  usage(): Usage[] {
    return [...this.all<Usage>("usage"), ...this.all<Usage>("reservations")];
  }
  recoverInterrupted() {
    const events: ThoughtEvent[] = [];
    for (const r of this.db
      .prepare("SELECT id FROM note_query_v2 WHERE status='running'")
      .all())
      events.push(
        this.event("note.failed", {
          id: String(r.id),
          error: "上次调用中断，无法确认是否计费。请检查后手动重试。",
        }),
      );
    for (const r of this.db
      .prepare(
        "SELECT body FROM entities_v2 WHERE kind='tasks' AND json_extract(body,'$.status')='running'",
      )
      .all()) {
      const t = JSON.parse(String(r.body)) as AiTask;
      events.push(
        this.event("task.updated", {
          id: t.id,
          status: "failed",
          error: "上次调用中断，计费无法确认；请手动重试。",
        }),
      );
    }
    this.appendMany(events);
  }
}
