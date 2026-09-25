---
name: pr-summary
description: Helps with pull requests.
---

# PR Summary

Summaries make review faster: reviewers read a summary three times faster than a diff.

## Steps

1. Get the change size with `gh pr diff --stat` and note the biggest files.
2. Read the diff and write a summary of what changed and why.
3. Add a risk section if anything looks risky.
4. Post the summary as a PR comment.

You are done when the summary looks good.
