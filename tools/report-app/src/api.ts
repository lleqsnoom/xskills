/** The shapes `scripts/report-server.mjs` answers with, and the one place that fetches them. */

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
    /** The band for that day's score, decided by the server: a screen never bands a score itself. */
    band: Band;
    sample: { id: string; host: string | null; title: string | null } | null;
  }[];
  dimensions: Dimensions | null;
  /** Why it moved: the signals that blamed this skill, and the day's proposals that target it. */
  signals: (Signal & { date: string })[];
  /** The day the digest was read on, which is how a proposal found on a skill's screen still knows its day. */
  proposals: (Proposal & { date: string })[];
};

export type SessionDetail = { date: string; session: Session; signals: Signal[] };


























/**
 * One request per URL, shared by whichever screens ask for it: the rail, the movement table and the calendar
 * all want the same movement payload, and three identical requests on first paint is three chances to
 * disagree. A write clears the lot, because every answer here is derived from the same files.
 */
const cache = new Map<string, Promise<unknown>>();

async function get<T>(path: string): Promise<T> {
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
  /** Which bundle the server is serving now — asked afresh, because a cached answer is the wrong answer here. */
  version: async (): Promise<{ build: string | null }> => {
    const response = await fetch("/api/version", { cache: "no-store" });
    if (!response.ok) throw new Error(`could not ask for the version: ${response.status}`);
    return (await response.json()) as { build: string | null };
  },
  refresh: async () => {
    const result = await get<{ ok: boolean; day?: string; inUse?: number; packs?: string[]; reason?: string }>("/api/refresh");
    cache.clear();
    return result;
  },
  invalidate: () => cache.clear(),
  saveTodos: async (items: TodoItem[]): Promise<Todos> => {
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
