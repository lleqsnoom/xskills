# Spec — API rate limiting

## Contract
- Every authenticated request is counted against its API key; an unauthenticated request against
  its client IP.
- Limit: 600 requests per key per rolling 60 s (token bucket, capacity 600, refill 10/s). IPs: 60
  per 60 s. Both live in `config/limits.json`, read at start-up.
- A request over the limit gets `429 Too Many Requests` (RFC 6585, §4) with a `Retry-After` header
  (RFC 9110, §10.2.3) giving whole seconds until one token is available, and is not processed.
- Every response carries `RateLimit-Remaining`.

## Invariants
- A request that was answered 429 consumed no token.
- The limiter adds at most 2 ms p99 to a request (measured at the gateway, Redis on the same VPC).
- If Redis is unreachable the limiter fails open and logs `ratelimit.redis_down` once per minute;
  it never answers 429 because of its own failure.

## Tests
1. 600 requests in 1 s with one key: all 200. The 601st: 429, `Retry-After: 1`.
2. After a 429, waiting `Retry-After` seconds, the next request is 200.
3. Two keys at 600/s each: neither affects the other.
4. Redis stopped: requests are 200 and one `ratelimit.redis_down` line is logged per minute.
5. `k6 run load/ratelimit.js` at 2,000 req/s: added p99 ≤ 2 ms.

## Not in scope
Per-endpoint limits, and limits by plan tier. Both need the billing data model first.
