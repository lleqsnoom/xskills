# Why `checkout.test.ts` fails about 1 run in 20

## Question
`checkout.test.ts` failed 23 times in the last 500 CI runs (4.6%). The other 1,900 tests failed 4
times in total. What makes this one flaky, and what should we change?

## Evidence
- All 23 failures are the same assertion: `expect(order.status).toBe("paid")` receives `"pending"`
  (CI logs, runs listed in `flaky-runs.csv`).
- The test does not await the payment webhook; it sleeps 200 ms and then reads the order
  (`checkout.test.ts:88`).
- Locally, with the webhook handler delayed by 300 ms, the test fails 50 times out of 50. With no
  added delay it passes 200 times out of 200.
- The 23 failing runs had a median webhook latency of 340 ms against 90 ms in passing runs, from
  the test server's timing log.

## Hypotheses ruled out
- Shared database state: the failure also happens with the suite run alone (`--runInBand`, 3 of 60).
- Clock skew: the assertion is on a status, not a timestamp.

## Thesis
The test races the webhook: it reads the order after a fixed 200 ms, and the webhook sometimes
takes longer.

## Recommendation
Replace the sleep with a wait on the order's status (`await waitFor(() => status === "paid",
{ timeout: 5000 })`). Check: 500 local runs with the 300 ms delay, 0 failures. Not tested: whether
the webhook's slow tail is a production problem too; that needs the production latency data.
