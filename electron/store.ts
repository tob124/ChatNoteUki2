import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  aiNoteSchema,
  captureSchema,
  emptyContent,
  eventSchema,
  stateContentSchema,
  type Cognition,
  type InboxBatch,
  type Note,
  type Proposal,
  type Snapshot,
  type ThoughtEvent,
  type Usage,
} from "../src/shared";

const uuid = z.string().uuid();
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
});
const proposalSchema = z.object({
  id: uuid,
  threadId: uuid,
  baseVersion: z.number().int().nonnegative(),
  before: stateContentSchema,
  after: stateContentSchema,
  reason: z.string().max(2000),
  evidenceIds: z.array(uuid).max(20),
  status: z.literal("pending"),
  createdAt: z.string().datetime(),
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
const payloadSchemas = {
  "note.added": noteSchema,
  "note.started": z.object({ id: uuid }),
  "note.completed": z.object({
    id: uuid,
    result: aiNoteSchema,
    threadId: uuid,
  }),
  "note.failed": z.object({ id: uuid, error: z.string().max(1000) }),
  "note.retried": z.object({ id: uuid }),
  "note.moved": z.object({ id: uuid, threadId: uuid }),
  "thread.added": z.object({
    id: uuid,
    title: z.string().min(1).max(60),
    createdAt: z.string().datetime(),
  }),
  "proposal.added": proposalSchema,
  "proposal.resolved": z.object({
    id: uuid,
    decision: z.enum(["accept", "reject"]),
    content: stateContentSchema.optional(),
  }),
  "inbox.observed": batchSchema,
  "inbox.conflict": batchSchema.extend({ status: z.literal("conflict") }),
  "inbox.cleared": z.object({ id: uuid }),
  "usage.recorded": z.object({
    id: uuid,
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    model: z.string().max(100),
    createdAt: z.string().datetime(),
  }),
  "usage.reserved": z.object({
    id: uuid,
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    model: z.string().max(100),
    createdAt: z.string().datetime(),
  }),
  "usage.released": z.object({ id: uuid }),
};

function blank(): Snapshot {
  return {
    notes: [],
    threads: [],
    cognitions: [],
    proposals: [],
    batches: [],
    usage: [],
    reservations: [],
  };
}
export function validateEvent(input: unknown): ThoughtEvent {
  const event = eventSchema.parse(input);
  return { ...event, payload: payloadSchemas[event.type].parse(event.payload) };
}
function apply(state: Snapshot, event: ThoughtEvent) {
  const p = event.payload as Record<string, any>;
  const note = () => {
    const n = state.notes.find((n) => n.id === p.id);
    if (!n) throw new Error("事件引用了不存在的记录");
    return n;
  };
  const requireThread = (id: string) => {
    if (!state.threads.some((t) => t.id === id))
      throw new Error("思考线程不存在");
  };
  switch (event.type) {
    case "note.added":
      if (state.notes.some((n) => n.id === p.id))
        throw new Error("记录 ID 重复");
      if (p.threadId) requireThread(p.threadId);
      state.notes.push(p as Note);
      break;
    case "thread.added":
      if (state.threads.some((t) => t.id === p.id))
        throw new Error("线程 ID 重复");
      state.threads.push(p as Snapshot["threads"][number]);
      break;
    case "note.started":
      note().status = "running";
      note().error = null;
      break;
    case "note.completed":
      requireThread(p.threadId);
      if (note().mode === "note" && p.result.reply.length > 150)
        throw new Error("自动回应超过长度限制");
      Object.assign(note(), {
        title: p.result.title,
        synopsis: p.result.synopsis,
        reply: p.result.reply,
        threadId: p.threadId,
        status: "done",
        error: null,
      });
      break;
    case "note.failed":
      note().status = "failed";
      note().error = p.error;
      break;
    case "note.retried":
      if (note().status !== "failed") throw new Error("只有失败的记录可以重试");
      note().status = "pending";
      note().error = null;
      break;
    case "note.moved":
      requireThread(p.threadId);
      note().threadId = p.threadId;
      break;
    case "proposal.added": {
      requireThread(p.threadId);
      if (state.proposals.some((x) => x.id === p.id))
        throw new Error("建议 ID 重复");
      const current = state.cognitions.find((c) => c.threadId === p.threadId);
      if ((current?.version ?? 0) !== p.baseVersion)
        throw new Error("当前认知已经变化，请重新生成建议");
      for (const id of p.evidenceIds)
        if (!state.notes.some((n) => n.id === id))
          throw new Error("建议引用了不存在的历史");
      state.proposals.push(p as Proposal);
      break;
    }
    case "proposal.resolved": {
      const proposal = state.proposals.find((x) => x.id === p.id);
      if (!proposal || proposal.status !== "pending")
        throw new Error("建议已处理或不存在");
      if (p.decision === "reject") {
        proposal.status = "rejected";
        break;
      }
      const index = state.cognitions.findIndex(
        (c) => c.threadId === proposal.threadId,
      );
      if ((state.cognitions[index]?.version ?? 0) !== proposal.baseVersion)
        throw new Error("这份建议已过期，请重新生成");
      const next: Cognition = {
        ...(p.content ?? proposal.after),
        threadId: proposal.threadId,
        version: proposal.baseVersion + 1,
      };
      if (index < 0) state.cognitions.push(next);
      else state.cognitions[index] = next;
      proposal.acceptedContent = p.content ?? proposal.after;
      proposal.status = "accepted";
      break;
    }
    case "inbox.observed":
    case "inbox.conflict":
      if (state.batches.some((b) => b.id === p.id))
        throw new Error("导入批次重复");
      state.batches.push(p as InboxBatch);
      break;
    case "inbox.cleared": {
      const batch = state.batches.find((b) => b.id === p.id);
      if (!batch) throw new Error("导入批次不存在");
      batch.status = "cleared";
      break;
    }
    case "usage.reserved":
      state.reservations.push(p as Usage);
      break;
    case "usage.released":
      state.reservations = state.reservations.filter((r) => r.id !== p.id);
      break;
    case "usage.recorded":
      state.usage.push(p as Usage);
      state.reservations = state.reservations.filter((r) => r.id !== p.id);
      break;
  }
}

export class Store {
  private db: DatabaseSync;
  private state = blank();
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, raw TEXT NOT NULL, title TEXT NOT NULL, synopsis TEXT NOT NULL, reply TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search_notes USING fts5(id UNINDEXED, raw, title, synopsis, reply, tokenize='trigram');`);
    for (const row of this.db
      .prepare("SELECT body FROM events ORDER BY seq")
      .all())
      apply(this.state, validateEvent(JSON.parse(String(row.body))));
    this.reindex();
    if (!this.getMeta("deviceId")) this.setMeta("deviceId", randomUUID());
  }
  close() {
    this.db.close();
  }
  snapshot(): Snapshot {
    return structuredClone(this.state);
  }
  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? String(row.value) : null;
  }
  setMeta(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
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
    const unique = events.filter(
      (e) => !this.db.prepare("SELECT 1 FROM events WHERE id=?").get(e.id),
    );
    if (!unique.length) return;
    const candidate = structuredClone(this.state);
    const validated = unique.map(validateEvent);
    for (const event of validated) apply(candidate, event);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.db.prepare("INSERT INTO events(id,body) VALUES(?,?)");
      for (const event of validated)
        insert.run(event.id, JSON.stringify(event));
      this.index(candidate);
      this.db.exec("COMMIT");
      this.state = candidate;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private index(state: Snapshot) {
    // Rebuild only changed rows; immutable history remains in events.
    const select = this.db.prepare(
      "SELECT raw,title,synopsis,reply FROM notes WHERE id=?",
    );
    const insert = this.db.prepare(
      "INSERT INTO notes VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET raw=excluded.raw,title=excluded.title,synopsis=excluded.synopsis,reply=excluded.reply",
    );
    const del = this.db.prepare("DELETE FROM search_notes WHERE id=?");
    const fts = this.db.prepare(
      "INSERT INTO search_notes(id,raw,title,synopsis,reply) VALUES(?,?,?,?,?)",
    );
    for (const n of state.notes) {
      const old = select.get(n.id);
      const reply = n.reply ?? "";
      if (
        old &&
        old.raw === n.raw &&
        old.title === n.title &&
        old.synopsis === n.synopsis &&
        old.reply === reply
      )
        continue;
      insert.run(n.id, n.raw, n.title, n.synopsis, reply);
      del.run(n.id);
      fts.run(n.id, n.raw, n.title, n.synopsis, reply);
    }
  }
  private reindex() {
    this.db.exec("BEGIN");
    try {
      this.index(this.state);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
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
  latestSeq(): number {
    return Number(
      this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events").get()
        ?.seq ?? 0,
    );
  }
  createNote(
    rawInput: unknown,
    source: Note["source"] = "desktop",
    id: string = randomUUID(),
  ): Note {
    const input = captureSchema.parse(rawInput);
    return {
      id,
      raw: input.raw,
      title: (input.raw.split(/\r\n|\r|\n/).find((s) => s.trim()) ?? "新想法")
        .trim()
        .slice(0, 80),
      synopsis: "待生成",
      reply: null,
      threadId: input.threadId,
      createdAt: new Date().toISOString(),
      source,
      mode: input.mode,
      model: input.model,
      status: "pending",
      error: null,
    };
  }
  capture(input: unknown): string {
    const note = this.createNote(input);
    this.append("note.added", note);
    return note.id;
  }
  cognition(threadId: string): Cognition {
    return (
      this.snapshot().cognitions.find((c) => c.threadId === threadId) ?? {
        ...emptyContent(),
        threadId,
        version: 0,
      }
    );
  }
  search(query: string): Note[] {
    const q = query.trim().slice(0, 200);
    if (!q) return this.snapshot().notes;
    const terms = q.split(/\s+/);
    let ids: string[];
    if (terms.every((t) => [...t].length >= 3)) {
      const match = terms
        .map((t) => `"${t.replaceAll('"', '""')}"`)
        .join(" AND ");
      ids = this.db
        .prepare(
          "SELECT id FROM search_notes WHERE search_notes MATCH ? ORDER BY rank LIMIT 500",
        )
        .all(match)
        .map((r) => String(r.id));
    } else {
      const clauses = terms
        .map(
          () =>
            "(raw||' '||title||' '||synopsis||' '||reply) LIKE ? ESCAPE '\\'",
        )
        .join(" AND ");
      ids = this.db
        .prepare(`SELECT id FROM notes WHERE ${clauses} LIMIT 500`)
        .all(...terms.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`))
        .map((r) => String(r.id));
    }
    const rank = new Map(ids.map((id, i) => [id, i]));
    return this.snapshot()
      .notes.filter((n) => rank.has(n.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  }
  recoverInterrupted() {
    const events = this.state.notes
      .filter((n) => n.status === "running")
      .map((n) =>
        this.event("note.failed", {
          id: n.id,
          error: "上次调用中断，无法确认是否计费。请检查后手动重试。",
        }),
      );
    this.appendMany(events);
  }
}
