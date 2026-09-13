# Article best practices — the pre-roast checklist

Clear these before recording the first roast; they are what `x-roast`'s `clarity`,
`logic`, `evidence` and `balance` dimensions measure. This is the *article* path;
a paper adds method/reproducibility and a formal reference style.

## Shape

- **One `h1`, and only one.** Title states the claim, not the topic ("Sampling is
  a substance, not a parameter", not "On sampling").
- **Claim first.** The central claim appears in the opening paragraph, stated in
  one sentence a reader could repeat. Everything below defends it.
- **Scannable structure.** `##`/`###` headings that read as an outline; short
  paragraphs; bold for the load-bearing phrase, not decoration.
- **End with the references list** when the piece cites sources (`## References`).

## Content

- **Claim → evidence → warrant.** Every section earns its place: state the point,
  show the evidence, explain why the evidence supports the point.
- **Cite load-bearing claims.** A claim the argument collapses without gets a
  primary source. Secondary summaries are a fallback, not the norm.
- **Handle the strongest counterargument**, not a strawman. Say where you are
  uncertain; overclaiming is a `balance` failure.
- **No filler.** Cut "it is important to note that", "due to the fact that",
  "basically", "very". (Also an `x-humanize` rule — keep both honest.)

## Before you roast — verify the mutable facts

Every proxy for live state can be stale. If the article describes a codebase, a
version, or a count, re-derive it from the current source or the remote, and date
what you assert:

```bash
gh api repos/<owner>/<repo>/contents/<dir> --jq length      # a directory count
curl -s https://registry.npmjs.org/<pkg> | head -c 200      # the published version
```

Probe every cited URL as a reader (no credentials) before it ships:

```bash
for u in <urls>; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 20 "$u")  $u"
done
```

A `403` from a bot user-agent is not proof a page is gone — confirm through the
service's own API before dropping the citation. (Details: `blog-post-authoring`.)

## Hand-off to the site

This skill stops at the finished prose. Publishing is `blog-post-authoring`:
filename = slug, `draft: false` to appear, frontmatter fields (`title`,
`description`, `date`, `author: "Tomasz Kwiatek"`, `tags[]`, `image`), the og card
at `public/images/<slug>-og.png`, `npm run thumbs`, then the build check and the
live-URL check. Keep the split: this skill never touches frontmatter or assets.
