/** The shapes `scripts/report-server.mjs` answers with, and the one place that fetches them. */

import { bakedAt, bakedReport, missingSentence, writeRefused } from "./baked.mjs";

/** True when this build is a baked panel: answers come from the snapshot, and nothing is written. */
export const isSnapshot = () => bakedReport() !== null;

/** The app has six read routes and two writes, and a snapshot can only serve the reads. */
function refuseInSnapshot(path: string): void {
  const snapshot = bakedReport();
  if (snapshot) throw new Error(writeRefused(snapshot, path));
}

export type Band = { key: "good" | "fair" | "weak" | "unknown"; label: string };

export type AxisName = "conformance" | "adherence" | "trigger" | "rework" | "protocol";

/** The axes in the order the scanner reports them, so a chart can lay them out without inventing an order. */
export const AXIS_ORDER: AxisName[] = ["conformance", "adherence", "trigger", "rework", "protocol"];

export type Dimensions = Partial<Record<AxisName, number | null>>;

export type SeriesPoint = {
  date: string;
  score: number | null;
  raw: number | null;
  n: number | null;
  dimensions: Dimensions | null;
};

export type Moved = { name: AxisName; delta: number; points: number };

export type MovementRow = {
  name: string;
  series: SeriesPoint[];
  measured: number;
  first: string | null;
  latest: string | null;
  latestScore: number | null;
  change: number | null;
  band: Band;
  moved: Moved[];
  direction: "up" | "down" | "flat";
};

export type RecentDay = {
  date: string;
  mean: number | null;
  band: Band;
  sessions: number | null;
  measured: number;
  scored: number;
  skills: number;
};

export type CalendarCell = { day: number | null; date: string | null; recorded: boolean };
export type CalendarMonth = { month: string; cells: CalendarCell[] };

export type TodoItem = {
  id: string;
  /** The day the proposal came from: two days can each propose a `P1`, so this is what tells them apart. */
  day: string | null;
  skill: string | null;
  change: string | null;
  reason: string | null;
  expected: string | null;
  target: string | null;
  route: string | null;
  signal: string | null;
  note: string | null;
};

export type Todos = { updatedAt: string | null; items: TodoItem[] };

export type MovementPage = {
  days: number;
  movement: MovementRow[];
  recent: RecentDay[];
  calendar: CalendarMonth[];
  newest: string | null;
  hasPack: boolean;
  todos: Todos;
};

export type SessionStats = {
  messages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  panels: number;
  toolFailures: number;
  expectedExits: number;
  repeats: number;
  corrections: number;
  reprompts: number;
  proseQuestions: number;
};

export type Session = {
  id: string;
  host: string | null;
  uuid: string | null;
  title: string | null;
  project: string | null;
  modified: string | null;
  stats: SessionStats;
  skills: { loaded: string[]; used: string[]; unused: string[] };
  checks: { skill: string; script: string; calls: number; passes: number; refusals: number; fails: number }[];
  graphs: { skill: string; calls: number; illegalMoves: number; prematureTransitions: number }[];
  runFolders: string[];
  artifacts: string[];
  high: number;
};

export type Signal = {
  id: string;
  kind: string;
  severity: "high" | "medium" | "low";
  summary: string;
  count: number;
  suspects: string[];
  session: string;
  sessionTitle: string | null;
  evidence: { message: number; tool: string | null; excerpt: string }[];
};

export type Proposal = {
  id: string;
  title: string;
  skill: string | null;
  target: string | null;
  signal: string | null;
  change: string | null;
  reason: string | null;
  expected: string | null;
  route: string | null;
  /** The day the digest proposed it on, and whether the reader has already kept it. */
  day?: string | null;
  inTodo?: boolean;
};

export type DayPack = {
  date: string;
  generatedAt: string | null;
  window: { hours: number; since: string; until: string } | null;
  hosts: { id: string; label: string; status: string; sessions: number; store: string }[];
  counts: Record<string, number>;
  skills: { touched: { name: string; sessions: number; loaded: number; used: number }[]; idle: string[] };
  warnings: { scope: string; reason: string }[];
  notes: string[];
  sessions: Session[];
  signals: Signal[];
  runFolders: string[];
  artifacts: string[];
};

export type Day = {
  pack: DayPack;
  proposals: Proposal[];
  digest: string | null;
  history: { date: string; sessions: number | null; skills: { name: string; score: number | null; raw: number | null; n: number }[] } | null;
  scores: { name: string; score: number | null; raw: number | null; n: number; named: number; status: string; dimensions: Dimensions; band: Band }[];
};

export type Skill = MovementRow & {
  perDay: {
    date: string;
    score: number | null;
    raw: number | null;
    n: number | null;
    named: number | null;
    dimensions: Dimensions | null;
    sample: { id: string; host: string | null; title: string | null } | null;
  }[];
  dimensions: Dimensions | null;
  /** Why it moved: the signals that blamed this skill, and the day's proposals that target it. */
  signals: (Signal & { date: string })[];
  proposals: (Proposal & { date: string })[];
};

export type SessionDetail = { date: string; session: Session; signals: Signal[] };

/** What the server did with a `Run`: which surface, and whether it reused a surface that was already open. */
export type OpenResult = { ok: boolean; surface: string; how: string; url: string; message: string };

/**
 * One request per URL, shared by whichever screens ask for it: the rail, the movement table and the calendar
 * all want the same movement payload, and three identical requests on first paint is three chances to
 * disagree. A write clears the lot, because every answer here is derived from the same files.
 */
const cache = new Map<string, Promise<unknown>>();

async function get<T>(path: string): Promise<T> {
  const snapshot = bakedReport();
  if (snapshot) {
    const payload = bakedAt(snapshot, path);
    if (payload === null) throw new Error(missingSentence(snapshot, path));
    return payload as T;
  }
  const cached = cache.get(path);
  if (cached) return cached as Promise<T>;
  const request = (async () => {
    const response = await fetch(path);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: `${response.status} ${response.statusText}` }));
      throw new Error(body.error ?? `failed: ${path}`);
    }
    return (await response.json()) as T;
  })();
  cache.set(path, request);
  request.catch(() => cache.delete(path)); // a failure is not worth remembering
  return request;
}

export const api = {
  movement: (days = 14) => get<MovementPage>(`/api/movement?days=${days}`),
  day: (date: string) => get<Day>(`/api/day/${date}`),
  session: (date: string, id: string) => get<SessionDetail>(`/api/day/${date}/session/${encodeURIComponent(id)}`),
  skill: (name: string) => get<Skill>(`/api/skill/${name}`),
  todos: () => get<Todos>("/api/todos"),
  refresh: async () => {
    const result = await get<{ ok: boolean; day?: string; inUse?: number; packs?: string[]; reason?: string }>("/api/refresh");
    cache.clear();
    return result;
  },
  invalidate: () => cache.clear(),
  /**
   * Ask the machine to put this report in front of the reader: an Orca tab, or a window with no browser
   * controls at all. The server owns the decision — the page only says which surface it wants, and where it
   * is, so the tab that opens (or is focused) is the screen the reader was on.
   */
  open: async (surface: "orca" | "window"): Promise<OpenResult> => {
    refuseInSnapshot("/api/open");
    const response = await fetch("/api/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surface, path: `${window.location.pathname}${window.location.search}` }),
    });
    const body = (await response.json().catch(() => ({ message: `could not open: ${response.status}` }))) as OpenResult;
    if (!response.ok) throw new Error(body.message ?? `could not open: ${response.status}`);
    return body;
  },
  saveTodos: async (items: TodoItem[]): Promise<Todos> => {
    refuseInSnapshot("/api/todos");
    const response = await fetch("/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!response.ok) throw new Error(`could not save: ${response.status}`);
    const written = (await response.json()) as Todos;
    cache.clear();
    return written;
  },
};
