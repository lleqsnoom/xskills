/**
 * Where a chart puts things. Plain functions with no DOM and no framework, because this is the part worth
 * testing and the part that has to be right: a scale that lies about the gaps, or labels that overlap, are
 * bugs you cannot see in a component test but can catch with a hundred synthetic days.
 *
 * A point's x comes from its *age*, not its index. With `log` the axis gives equal room to equal ratios of
 * age, so the last few days get most of the width and a year of history compresses into the left of it —
 * which is the shape of the question a reader has ("what changed lately"). `DAY_BIAS` sets how hard it bends:
 * the logarithm is of `1 + age / DAY_BIAS`, so a raw `log(age)` cannot put day one at infinity and hand the
 * newest day the whole chart. At `DAY_BIAS = 3`, a day old sits 17% along a 90-day history and the last week
 * holds a third of the width.
 */

/** How much of the axis the recent days get. See the note above. */
export const DAY_BIAS = 3;

const DAY_MS = 86_400_000;

/** How many days before the newest point each point is. The newest is 0; an unparseable date counts as 0. */
export function daysAgo(dates) {
  const last = Date.parse(`${dates[dates.length - 1] ?? ""}T00:00:00Z`);
  return dates.map((date) => {
    const at = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(at) && Number.isFinite(last) ? Math.max(0, Math.round((last - at) / DAY_MS)) : 0;
  });
}

/** The x of each point, oldest first: `linear` spaces them by index, `log` by the logarithm of their age. */
export function placeX({ ages, width, pad = 3, scale = "log" }) {
  const count = ages.length;
  if (scale !== "log") return ages.map((_, index) => pad + (index * (width - pad * 2)) / Math.max(count - 1, 1));
  const span = Math.log(1 + Math.max(0, ...ages) / DAY_BIAS);
  return ages.map((age) => {
    const along = span > 0 ? Math.log(1 + age / DAY_BIAS) / span : 0;
    return width - pad - along * (width - pad * 2);
  });
}

/**
 * The column of the plot a point answers to: half the way to each neighbour, with the outer two reaching the
 * frame's own edges. They tile the width exactly, so every x belongs to a day and rolling over the plot always
 * names one — which is what "roll over a day" has to mean.
 */
export function columns(xs, width) {
  return xs.map((x, index) => {
    const before = xs[index - 1] ?? 0;
    const after = xs[index + 1] ?? width;
    return {
      left: index === 0 ? 0 : (before + x) / 2,
      right: index === xs.length - 1 ? width : (x + after) / 2,
    };
  });
}

/**
 * The items worth a label, newest first. Walking from the right means the recent days win the space when there
 * is not enough of it, and nothing lands closer than `gap` to something already placed; the newest always
 * keeps its label, so a chart is never unlabelled.
 */
export function labelSet(items, gap) {
  const keep = [];
  let previous = Number.POSITIVE_INFINITY;
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (!item) continue;
    if (keep.length === 0 || previous - item.x >= gap) {
      keep.push(item);
      previous = item.x;
    }
  }
  return keep;
}
