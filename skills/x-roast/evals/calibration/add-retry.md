# Task 2.1 — Retry a failed upload with exponential backoff

**Layer:** L2 — Resilience · **Estimate:** 3 h (Task 1.2, the uploader it wraps, took 4 h)

## Change
`src/upload.js`: wrap `putObject` in `withRetry(fn, { attempts: 4, baseMs: 200 })`. Retry only on
a network error or a 5xx; a 4xx fails at once. The delays are 200, 400 and 800 ms.

## Definition of done
- `node --test test/upload.test.js` exits 0.
- A stubbed `putObject` that fails twice with 503 and then succeeds is called 3 times, and the
  upload resolves.
- A stubbed 403 is called once, and the upload rejects with that error.
- The L1 tests still pass: `node --test test/` exits 0.

## Not in scope
Jitter and a circuit breaker. They are Task 2.2.
