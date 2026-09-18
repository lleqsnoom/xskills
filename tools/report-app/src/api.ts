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

/** One side of a fix's window: the measured days before or after it, and how many there were. */
export type SeriesWindow = { mean: number | null; days: number; calls: number; thin: number; dates: string[] };

export type Verdict = "held" | "flat" | "regressed" | "measuring" | "unmeasured" | "no-commit";

/** One kept fix: what was wrong, where, when a commit touched it, and what the score did around that. */
export type LedgerItem = {
  id: string;
  day: string | null;
  skill: string | null;
  klass: string;
  title: string | null;
  change: string | null;
  target: string | null;
  path: string | null;
  check: string | null;
  signal: string | null;
  route: string | null;
  landed: string | null;
  /** The last commit before the decision, when the fix has not landed: context, not a landing. */
  lastCommit: string | null;
  before: SeriesWindow | null;
  after: SeriesWindow | null;
  needDays: number;
  verdict: Verdict;
  cameBack: boolean;
};

export type LedgerPage = {
  today: string;
  windowDays: number;
  summary: { shipped: number; held: number; flat: number; regressed: number; measuring: number; notLanded: number; cameBack: number };
  items: LedgerItem[];
  from: string | null;
  to: string | null;
  days: number;
  proposals: number;
};

/** Where a floor came from: the reader committed to it, a run of days held it, or the whole window did. */
export type Floor = {
  value: number;
  since: string | null;
  basis: number | null;
  reason: string | null;
  held: boolean;
  source: "reader" | "run" | "window";
  n: number | null;
};

export type RatchetSkill = {
  name: string;
  series: SeriesPoint[];
  latest: string | null;
  latestScore: number | null;
  latestSolid: boolean;
  n: number | null;
  band: Band;
  floor: Floor | null;
  belowBy: number | null;
  regressions: number;
  measuredDays: number;
  status: "below" | "held" | "thin";
};

export type RatchetPage = {
  today: string;
  window: number;
  sampleFloor: number;
  skills: RatchetSkill[];
  below: number;
  budget: number;
  state: { key: "under" | "at" | "over"; label: string };
  updatedAt: string | null;
  days: number;
};

/** A proposal on the bench, carrying the reason it was picked. */
export type BenchTask = {
  id: string;
  day: string | null;
  klass: string;
  title: string | null;
  path: string | null;
  target: string | null;
  skill: string | null;
  change: string | null;
  reason?: string | null;
  expected: string | null;
  route: string | null;
  signal: string | null;
  severity: "high" | "medium" | "low" | "unknown";
  sessions: string[];
  recurrence: number;
  score?: number;
  why?: string;
  from: string | null;
  landed?: string | null;
  after?: SeriesWindow;
  left?: number;
};

export type BenchPage = {
  today: string;
  window: number;
  sampleFloor: number;
  now: BenchTask | null;
  next: BenchTask[];
  candidates: number;
  doing: BenchTask | null;
  queued: BenchTask[];
  waiting: BenchTask[];
  counts: { open: number; kept: number; inFlight: number; waiting: number };
};

export type Sighting = {
  date: string;
  id: string;
  klass: string;
  title: string | null;
  path: string | null;
  target: string | null;
  skill: string | null;
  change: string | null;
  reason?: string | null;
  expected: string | null;
  signal: string | null;
  severity: "high" | "medium" | "low" | "unknown";
  sessions: string[];
};

/** One file that keeps being the problem, and what happened after each fix attempt. */
export type Finding = {
  klass: string;
  klasses: string[];
  relabelled: boolean;
  path: string | null;
  target: string | null;
  skill: string | null;
  title: string | null;
  severity: "high" | "medium" | "low" | "unknown";
  first: string;
  last: string;
  days: number;
  sessions: string[];
  sightings: Sighting[];
  attempts: string[];
  lastFix: string | null;
  quietDays: number | null;
  sinceFix: number;
  status: "came-back" | "chronic" | "new" | "open" | "closed";
};

export type RecurrencePage = {
  today: string;
  summary: { open: number; cameBack: number; chronic: number; closed: number };
  findings: Finding[];
  from: string | null;
  to: string | null;
  days: number;
  closedAfterDays: number;
};

export type FloorResult = { ok: boolean; reason?: string; skill?: string; floor?: Floor & { at?: string } };

/** A control rule, with the false alarm it costs: the reason a fleet cannot afford a 2s rule. */
export type ControlRule = { key: string; kind: "reject" | "warn"; what: string; falseAlarm: number; because: string };

export type ControlSkill = {
  name: string;
  series: SeriesPoint[];
  center: number | null;
  latest: number | null;
  days: number;
  baselineDays: number;
  judgedDays: number;
  sigma: number | null;
  source: "own" | "pooled" | "none";
  limits: { one: number; two: number; three: number } | null;
  z: number | null;
  fired: string[];
  rejections: string[];
  alarming: boolean;
  warned: boolean;
};

export type ControlPage = {
  sigma: number | null;
  minDays: number;
  fleet: number;
  expectedAt2s: number;
  expectedAt3s: number;
  alarming: number;
  warned: number;
  skills: ControlSkill[];
  pooled: { sigma: number | null; pairs: number; spread: number | null; mdc: number | null };
  rules: ControlRule[];
  from: string | null;
  to: string | null;
  days: number;
};

export type IntervalSkill = {
  name: string;
  n: number | null;
  named: number | null;
  score: number | null;
  axes: number;
  se: number | null;
  half: number | null;
  low: number | null;
  high: number | null;
  conservative: number | null;
  source: "day" | "record";
  needsSessions: number | null;
};

export type IntervalPage = {
  z: number;
  fallbackSigma: number | null;
  skills: IntervalSkill[];
  pooled: { sigma: number | null; pairs: number; spread: number | null; mdc: number | null };
  sampleFloor: number;
  tallied: number;
  from: string | null;
  to: string | null;
  days: number;
};

/** One axis's share of the gap, in points, with the counters it was measured from. */
export type FactorCode = {
  axis: AxisName;
  rate: number;
  denominator: number;
  costs: number;
  weight: number;
  evidence: string;
  pooled: number | null;
  at100: number;
};

export type FactorSkill = {
  name: string;
  score: number | null;
  gap: number | null;
  codes: FactorCode[];
  top: FactorCode | null;
  n: number;
  named: number;
};

export type FactorsPage = {
  today: string | null;
  weights: Record<string, number>;
  pooled: Record<string, number | null>;
  skills: FactorSkill[];
  from: string | null;
  to: string | null;
  days: number;
};

export type FlowStage = { key: "proposed" | "kept" | "landed" | "closed"; label: string; count: number };

export type FlowPage = {
  today: string | null;
  dates: string[];
  perDay: {
    date: string;
    arrivals: number;
    kept: number;
    landed: number;
    closed: number;
    cumulative: { proposed: number; kept: number; landed: number; closed: number };
  }[];
  stages: FlowStage[];
  wip: number;
  arrivals: number;
  closures: number;
  arrivalsPerDay: number | null;
  closuresPerDay: number | null;
  oldestDays: number | null;
  waitAtArrivals: number | null;
  waitAtClosures: number | null;
  constraint: FlowStage["key"] | null;
  reached: FlowStage["key"][];
  floor: number;
  kept: number;
  findings: number;
  closedAfterDays: number;
  from: string | null;
  to: string | null;
};

export type ReviewRow = {
  path: string;
  klass: string;
  skill: string | null;
  severity: string;
  status: string;
  first: string;
  last: string;
  days: number;
  sessions: string[];
  step: number;
  ef: number;
  interval: number;
  due: string;
  overdueBy: number | null;
  lapses: number;
  reviewedAt: string | null;
  reformulated: boolean;
  auto: "came-back" | null;
};

export type SchedulePage = {
  today: string;
  due: ReviewRow[];
  dueCount: number;
  open: number;
  autoAnswered: number;
  next: ReviewRow[];
  updatedAt: string | null;
  steps: number[];
  perFindingChecks: number;
  arrivals: number;
  perDay: number | null;
  load: number | null;
  from: string | null;
  days: number;
};

export type ReviewResult = { ok: boolean; reason?: string; path?: string; review?: ReviewRow };

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
  /** The ledger reads a longer window than the movement table: a fix takes days to show up as held or flat. */
  ledger: (days = 30, window = 2) => get<LedgerPage>(`/api/ledger?days=${days}&window=${window}`),
  ratchet: (days = 14, budget = 2) => get<RatchetPage>(`/api/ratchet?days=${days}&budget=${budget}`),
  bench: (days = 14, window = 2) => get<BenchPage>(`/api/bench?days=${days}&window=${window}`),
  recurrence: (days = 14) => get<RecurrencePage>(`/api/recurrence?days=${days}`),
  control: (days = 14) => get<ControlPage>(`/api/control?days=${days}`),
  interval: (days = 14) => get<IntervalPage>(`/api/interval?days=${days}`),
  factors: (days = 14) => get<FactorsPage>(`/api/factors?days=${days}`),
  flow: (days = 14) => get<FlowPage>(`/api/flow?days=${days}`),
  schedule: (days = 14) => get<SchedulePage>(`/api/schedule?days=${days}`),
  /** One verdict on one finding: the schedule widens on `held`, resets on `came-back`. */
  review: async (path: string, outcome: "held" | "came-back" | "reformulate"): Promise<ReviewResult> => {
    refuseInSnapshot("/api/reviews");
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, outcome }),
    });
    const payload = (await response.json().catch(() => ({ ok: false, reason: `could not save: ${response.status}` }))) as ReviewResult;
    cache.clear();
    if (!response.ok) throw new Error(payload.reason ?? `could not save: ${response.status}`);
    return payload;
  },
  /**
   * Hold a floor in, or lower one with a reason. A floor that can be moved in silence is not a floor, so the
   * server refuses a silent lowering and this surfaces that refusal instead of pretending it worked.
   */
  saveFloor: async (body: { skill: string; action: "hold" | "lower"; reason?: string; value?: number }): Promise<FloorResult> => {
    refuseInSnapshot("/api/ratchet");
    const response = await fetch("/api/ratchet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({ ok: false, reason: `could not save: ${response.status}` }))) as FloorResult;
    cache.clear();
    if (!response.ok) throw new Error(payload.reason ?? `could not save: ${response.status}`);
    return payload;
  },
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
