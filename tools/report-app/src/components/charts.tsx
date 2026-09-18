import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { AXIS_ORDER, type AxisName, type Band, type Dimensions, type SeriesPoint } from "../api";
import { columns, daysAgo, labelSet, placeX } from "../chart-scale.mjs";

/**
 * The drawings. Small SVG components rather than a chart library: four shapes, no dependency, and they render
 * what the API already decided rather than recomputing it in the browser.
 */

/** A 270° car-style gauge, filled to the score. */
export function Gauge(props: { score: number | null; band: Band; size?: number; label?: string }) {
  const size = () => props.size ?? 92;
  const radius = () => size() * 0.39;
  const stroke = () => size() * 0.087;
  const centre = () => size() / 2;
  const sweep = 270;
  const start = 135;
  const point = (degrees: number) => {
    const radians = ((degrees - 90) * Math.PI) / 180;
    return { x: centre() + radius() * Math.cos(radians), y: centre() + radius() * Math.sin(radians) };
  };
  const arc = (from: number, to: number) => {
    const a = point(from);
    const b = point(to);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${radius().toFixed(2)} ${radius().toFixed(2)} 0 ${large} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
  };
  const value = () => Math.min(Math.max(props.score ?? 0, 0), 100);
  return (
    <svg viewBox={`0 0 ${size()} ${size()}`} width={size()} height={size()} role="img"
      aria-label={`${props.label ?? "score"} ${props.score ?? "not scored"} of 100`}>
      <path d={arc(start, start + sweep)} fill="none" stroke="var(--border)" stroke-width={stroke()} stroke-linecap="round" />
      <Show when={props.score !== null}>
        <path d={arc(start, start + (sweep * value()) / 100)} fill="none" stroke={`var(--${props.band.key})`}
          stroke-width={stroke()} stroke-linecap="round" />
      </Show>
    </svg>
  );
}

/** A plotted day: where it sits, and everything the tooltip needs to name it. */
type ChartPoint = {
  x: number;
  y: number;
  date: string;
  score: number;
  below: boolean;
  dimensions: Dimensions | null;
};

/**
 * A score per day as a line. By default it is scaled to its own range, which is right for the small line
 * beside a skill's row where the direction is the message. Pass a `domain` (and the `bands` to mark) when the
 * chart has to support a decision: a fixed 0-100 scale with the healthy and fair thresholds drawn is honest
 * about how far the score actually moved, and comparable between two skills.
 *
 * One rendering, because it is the right one at every size: a canvas paints the marks at the size they are
 * actually shown, so a line is the width it says and a dot is round without tricks, and a hundred days cost
 * one pass instead of a hundred elements. The scale and the frame live in `chart-scale.mjs`, and everything a
 * reader reads — the dates, the scores, the tooltip — is HTML over it. That is what let the rows drop the
 * fixed 190×26 SVG they started with: 190px of a 688px column, and nothing in it that knew the width.
 *
 * `annotate` adds the axis: the date under each day and the score of the points there is room for. `timeScale`
 * puts the x axis on the logarithm of age (see `chart-scale.mjs`), which is what makes a long history readable
 * — its dates are what keep a non-uniform scale honest.
 */
export function Sparkline(props: {
  points: SeriesPoint[];
  height?: number;
  domain?: [number, number];
  bands?: number[];
  annotate?: boolean;
  timeScale?: "linear" | "log";
  /**
   * The day the pointer or the keyboard is on, and who hears about it. A chart that annotates owns this while
   * nothing else does, but a page can take it over: the skill screen's chart drives the gauge and the radar
   * above it, so the day the reader is pointing at is the day the top of the page describes.
   */
  held?: string | null;
  onHold?: (date: string | null) => void;
}) {
  /** The drawing frame, in pixels: the plot's own height, then a row for the dates under it. */
  const PLOT = () => (props.annotate ? 132 : (props.height ?? 26));
  const pad = 3;
  const top = () => (props.annotate ? 14 : pad);

  // The canvas is painted at the width it is given; an observer measures that width, and the canvas cannot
  // resize its own box (CSS does), so the measurement cannot feed itself.
  const [measured, setMeasured] = createSignal<number | null>(null);
  const [surface, setSurface] = createSignal<HTMLCanvasElement | null>(null);
  const ref = (element: HTMLCanvasElement) => {
    let observer: ResizeObserver | undefined;
    const fit = () => setMeasured(Math.max(120, Math.round(element.getBoundingClientRect().width)));
    observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    setSurface(element);
    onCleanup(() => observer?.disconnect());
  };
  const VIEW_W = () => measured() ?? 190;

  const [dark, setDark] = createSignal(window.matchMedia("(prefers-color-scheme: dark)").matches);
  onMount(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const watch = () => setDark(media.matches);
    media.addEventListener("change", watch);
    onCleanup(() => media.removeEventListener("change", watch));
  });

  // Memoised, because every one of these is read once per element that is drawn: without it a hundred days
  // cost a hundred scales per scale, and the page stops answering. The scale itself is one pass over the days.
  const ages = createMemo(() => daysAgo(props.points.map((point) => point.date)));
  const xs = createMemo(() => placeX({ ages: ages(), width: VIEW_W(), scale: props.timeScale ?? "linear", pad }));
  const x = (index: number) => xs()[index] ?? pad;

  const y = (value: number) => {
    const [bottom, top_] = props.domain ?? [0, 100];
    return PLOT() - pad - ((value - bottom) / (top_ - bottom)) * (PLOT() - top() - pad);
  };

  const values = () =>
    props.points.flatMap((point) => {
      const score = point.raw ?? point.score;
      return score === null ? [] : [score];
    });

  const marks = () => {
    const [bottom, top_] = props.domain ?? [0, 100];
    return (props.bands ?? [])
      .filter((band) => band >= bottom && band <= top_)
      .map((value) => ({ value, y: y(value) }));
  };

  const dots = createMemo((): ChartPoint[] =>
    props.points.flatMap((point, index) => {
      const score = point.raw ?? point.score;
      return score === null
        ? []
        : { x: x(index), y: y(score), date: point.date, score, below: point.score === null, dimensions: point.dimensions };
    }));

  const areas = createMemo(() => columns(dots().map((dot) => dot.x), VIEW_W()));
  const labelled = (gap: number) => labelSet(dots(), gap);

  const [own, setOwn] = createSignal<string | null>(null);
  const held = () => (props.held !== undefined ? props.held : own());
  const hold = (date: string | null) => {
    if (props.held === undefined) setOwn(date);
    props.onHold?.(date);
  };
  const at = (date: string) => dots().find((dot) => dot.date === date) ?? null;
  // What the columns name, looked up once: the pointer walks these on every move.
  const named = createMemo(() => dots().map((dot) => `${dot.date}: ${dot.score.toFixed(1)}${dot.below ? " (below the sample floor)" : ""}`));

  const summary = () => {
    const scale = props.timeScale === "log" ? " on a logarithmic time axis" : "";
    const found = values();
    if (!found.length) return "nothing was scored";
    return `score per day${scale}, ${Math.min(...found).toFixed(0)} to ${Math.max(...found).toFixed(0)}${
      marks().length ? `, marks at ${marks().map((mark) => mark.value).join(" and ")}` : ""
    }`;
  };

  const paint = (canvas: HTMLCanvasElement) => {
    const width = VIEW_W();
    const height = PLOT();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ink = (name: string) => getComputedStyle(canvas).getPropertyValue(name).trim();
    const primary = ink("--primary");
    const border = ink("--border");
    const muted = ink("--muted-foreground");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(pad, y(0));
    ctx.lineTo(width - pad, y(0));
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    for (const mark of marks()) {
      ctx.beginPath();
      ctx.moveTo(pad, mark.y);
      ctx.lineTo(width - pad, mark.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const guide = held() ? at(held()!) : null;
    if (guide) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = muted;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(guide.x, top());
      ctx.lineTo(guide.x, y(0));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    const placed = dots();
    if (placed.length > 1) {
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      placed.forEach((dot, index) => (index === 0 ? ctx.moveTo(dot.x, dot.y) : ctx.lineTo(dot.x, dot.y)));
      ctx.stroke();
    }
    for (const dot of placed) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.below ? 2.4 : 3, 0, Math.PI * 2);
      // A day below the sample floor is a ring around the line rather than a solid mark; it is left unfilled
      // so the card shows through, where filling it with the page's background would paint a darker hole in it.
      if (dot.below) {
        ctx.strokeStyle = primary;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = primary;
        ctx.fill();
      }
    }
  };

  // Painted whenever anything the picture is made of changes: the measured width, the days, the pointer, the
  // theme. Reading them inside the effect is what subscribes it to them — including `dark()`, which is read
  // for its signal alone: the colours come from the live stylesheet through `getComputedStyle`, so nothing
  // else tells this effect that the tokens moved under it.
  createEffect(() => {
    const element = surface();
    dark();
    if (element) paint(element);
  });

  return (
    <Show when={values().length >= 2} fallback={<span class="dim">one day so far</span>}>
      <div classList={{ chart: true, annotated: props.annotate === true }} style={{ "--chart-plot": `${PLOT()}px` }}>
        <canvas class="chart-plot" ref={ref} role="img" aria-label={summary()} />
        <Show when={props.annotate}>
          {/* A target a pointer and a keyboard can both reach, in HTML so it does not shrink with the frame. */}
          <div class="chart-points">
            <For each={areas()}>
              {(area, index) => (
                <span class="chart-point" tabindex="0" role="img" aria-label={named()[index()] ?? ""}
                  style={{ left: `${(area.left / VIEW_W()) * 100}%`, width: `${((area.right - area.left) / VIEW_W()) * 100}%` }}
                  onMouseEnter={() => hold(dots()[index()]?.date ?? null)} onMouseLeave={() => hold(null)}
                  onFocus={() => hold(dots()[index()]?.date ?? null)} onBlur={() => hold(null)} />
              )}
            </For>
          </div>
          {/* A line down the day the pointer is on, so the top of the page and the chart agree on which day
              is being described. What that day *was* is not a popup: it is the gauge and the radar above. */}
          <Show when={held() ? at(held()!) : null} keyed>
            {(dot) => <span class="chart-guide" style={{ left: `${(dot.x / VIEW_W()) * 100}%` }} />}
          </Show>
          <div class="chart-values" aria-hidden="true">
            <For each={labelled(38)}>
              {(dot) => (
                <span style={{ left: `${(dot.x / VIEW_W()) * 100}%`, top: `${dot.y - 6}px` }}>{dot.score.toFixed(1)}</span>
              )}
            </For>
          </div>
          <div class="chart-dates" aria-hidden="true">
            <For each={[...labelled(56)].reverse()}>
              {(dot) => (
                <span style={{ left: `${(dot.x / VIEW_W()) * 100}%` }}>{dot.date.slice(5)}</span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

/** The axes a day actually measured, with their rates — the source of both the radar and its list form. */
export function measuredRates(dimensions: Partial<Record<AxisName, number | null>> | null) {
  return AXIS_ORDER.flatMap((name) => {
    const value = dimensions?.[name];
    return value === null || value === undefined ? [] : [{ name, value }];
  });
}

/**
 * The current state as a shape: one spoke an axis, the polygon through the latest day's rates. A radar answers
 * "what does this skill look like today" when a column of numbers does not — a flat shape is a skill that does
 * everything adequately, a spike is one axis carrying the rest.
 *
 * Only the axes the day actually measured get a spoke. An axis that does not apply to this skill is not part of
 * its shape, and a spoke scored zero for it would be a claim the scanner never made; with no axis measured
 * there is no shape, so the radar is not drawn at all.
 *
 * It is drawn in the page's own ink: the spokes are labelled with the axis's full name and its rate, so colour
 * has nothing left to say here, and a monochrome radar beside the gauge reads as one object with it. A ring is
 * 25%. The drawing is a fixed size in CSS terms — `width: min(100%, 420px)`, so it scales with its box — which
 * is why the labels have a floor: under 360px the box shows `AxisRates` instead, and text that cannot be read
 * at the size it was set is not rendered.
 */
export function Radar(props: {
  dimensions: Partial<Record<AxisName, number | null>> | null;
  label?: string;
  /** Off in a tooltip: there the rates are listed beside the shape, where 12px stays 12px. */
  names?: boolean;
}) {
  const rates = () => measuredRates(props.dimensions);
  // A fixed drawing space: the browser scales it to the box, so nothing here has to know how wide that is.
  const width = 420;
  const height = 260;
  const centre = { x: width / 2, y: height / 2 };
  const plot = props.names === false ? 68 : 76;
  const labelRing = props.names === false ? 84 : 100;
  const angle = (index: number) => ((-90 + index * (360 / Math.max(rates().length, 1))) * Math.PI) / 180;
  const at = (index: number, radius: number) => ({
    x: centre.x + radius * Math.cos(angle(index)),
    y: centre.y + radius * Math.sin(angle(index)),
  });
  const spokes = () => rates().map((axis, index) => ({ ...axis, vertex: at(index, plot * axis.value), label: at(index, labelRing) }));
  const ring = (fraction: number) =>
    rates()
      .map((_, index) => at(index, plot * fraction))
      .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
      .join(" ");
  const say = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <Show when={rates().length} fallback={<span class="dim">no axis was measured, so there is no shape yet</span>}>
      <svg class="radar" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
        aria-label={`${props.label ?? "the current state"} — ${rates().map((axis) => `${axis.name} ${say(axis.value)}`).join(", ")}`}>
        {/* Rings and spokes only make a shape from three axes up; two are a line and one is a point. */}
        <Show when={rates().length >= 3}>
          <For each={[0.25, 0.5, 0.75, 1]}>
            {(fraction) => <polygon points={ring(fraction)} fill="none" stroke="var(--border)" stroke-width={fraction === 1 ? 1.2 : 1} />}
          </For>
        </Show>
        <For each={spokes()}>
          {(_, index) => {
            const end = at(index(), plot);
            return <line x1={centre.x} y1={centre.y} x2={end.x.toFixed(1)} y2={end.y.toFixed(1)} stroke="var(--border)" stroke-width="1" />;
          }}
        </For>
        <polygon points={spokes().map((spoke) => `${spoke.vertex.x.toFixed(1)},${spoke.vertex.y.toFixed(1)}`).join(" ")}
          fill="var(--primary)" fill-opacity="0.12" stroke="var(--primary)" stroke-width="1.6" stroke-linejoin="round" />
        <For each={spokes()}>
          {(spoke) => (
            <>
              <circle cx={spoke.vertex.x.toFixed(1)} cy={spoke.vertex.y.toFixed(1)} r={3} fill="var(--primary)">
                <title>{`${spoke.name} ${say(spoke.value)}`}</title>
              </circle>
              <Show when={props.names !== false}>
                <text class="radar-label" x={spoke.label.x.toFixed(1)} y={(spoke.label.y + 4).toFixed(1)}
                  text-anchor={Math.abs(spoke.label.x - centre.x) < 6 ? "middle" : spoke.label.x > centre.x ? "start" : "end"}>
                  {spoke.name} {say(spoke.value)}
                </text>
              </Show>
            </>
          )}
        </For>
      </svg>
    </Show>
  );
}

/** The radar's numbers as a list, for the boxes too narrow to hold a labelled pentagon. */
export function AxisRates(props: { dimensions: Partial<Record<AxisName, number | null>> | null }) {
  return (
    <dl class="radar-list">
      <For each={measuredRates(props.dimensions)}>
        {(axis) => (
          <div>
            <dt class="dim">{axis.name}</dt>
            <dd class="num">{Math.round(axis.value * 100)}%</dd>
          </div>
        )}
      </For>
    </dl>
  );
}

/**
 * A point on a line, kept round in a chart that is stretched sideways. A circle would be squashed into an
 * ellipse by a non-uniform scale, so the dot is a zero-length line with a round cap: with a non-scaling stroke
 * it is drawn in the device's own pixels and stays a dot whatever the frame is. Hollow is a dot of the page's
 * background inside one of the line's colour, which is the ring the sample floor's marker used to be.
 */
function Dot(props: { x: number; y: number; radius: number; hollow?: boolean; title: string }) {
  const size = props.radius * 2;
  return (
    <g>
      <line x1={props.x} y1={props.y} x2={props.x + 0.01} y2={props.y} stroke="var(--primary)" stroke-width={size} stroke-linecap="round">
        <title>{props.title}</title>
      </line>
      <Show when={props.hollow}>
        <line x1={props.x} y1={props.y} x2={props.x + 0.01} y2={props.y} stroke="var(--background)" stroke-width={size - 2.4} stroke-linecap="round" />
      </Show>
    </g>
  );
}

/** A horizontal bar that is a rate. A row that never measured the axis gets a dash, not an empty track. */
export function Bar(props: { value: number | null; band: Band; width?: number }) {
  const width = () => props.width ?? 48;
  return (
    <Show when={props.value !== null} fallback={<span class="dim" style={{ display: "inline-block", "min-width": `${width()}px`, "text-align": "center" }}>—</span>}>
      <svg viewBox={`0 0 ${width()} 8`} width={width()} height={8} role="img" aria-label={`${Math.round((props.value ?? 0) * 100)} percent`}>
        <rect x="0" y="0" width={width()} height="8" rx="4" fill="var(--border)" />
        <rect x="0" y="0" width={Math.min(Math.max((props.value ?? 0) * width(), 1.5), width())} height="8" rx="4"
          fill={`var(--${props.band.key})`} />
      </svg>
    </Show>
  );
}

/** A shaded cell: the value, tinted on an eight-step ramp, for scanning a column for the weak axis. */
export function HeatCell(props: { value: number | null; title?: string }) {
  const step = () => (props.value === null ? -1 : Math.min(7, Math.max(0, Math.round(props.value * 7))));
  return (
    <span class="heat" data-step={step()} title={props.title}>
      {props.value === null ? "·" : `${Math.round(props.value * 100)}%`}
    </span>
  );
}
