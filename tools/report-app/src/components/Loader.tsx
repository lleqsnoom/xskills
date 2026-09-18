import { Show, type Accessor, type JSX, type Resource } from "solid-js";
import { errorMessage, settled, viewState } from "../resource.mjs";

/**
 * A resource's four states, drawn the same way everywhere.
 *
 * Every screen in this app loads one thing, and every screen has the same three sentences to say: what it is
 * waiting for, what to say when there is nothing, and the reason a fetch failed. Putting them in one place is
 * what makes the failure reachable at all — reading the accessor to build a `when` prop throws the error out
 * of the view's own update and strands it on the spinner it drew a moment earlier (see `resource.mjs`).
 */
export function Loader<T>(props: {
  resource: Resource<T>;
  /** What is being waited for, e.g. "Loading the record…". */
  loading: string;
  /** What an answer with nothing in it means, e.g. "No day has been recorded yet.". */
  empty: string;
  children: (value: Accessor<NonNullable<T>>) => JSX.Element;
}) {
  const state = () => viewState(props.resource);
  // An Error with an empty message would render as nothing at all, which is the blank screen this is here to
  // prevent, so the sentence has a floor even when the reason has none.
  const failure = () => (state() === "error" ? errorMessage(props.resource) || "the request failed" : undefined);
  return (
    <>
      <Show when={failure()}>{(reason) => <p class="failed">{reason()}</p>}</Show>
      <Show when={state() === "loading"}>
        <p class="loading">{props.loading}</p>
      </Show>
      <Show when={state() === "empty"}>
        <p class="empty">{props.empty}</p>
      </Show>
      <Show when={settled(props.resource)}>{(value) => props.children(value)}</Show>
    </>
  );
}
