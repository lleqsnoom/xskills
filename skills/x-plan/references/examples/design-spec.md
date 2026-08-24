# Worked Example: POST /auth/login

## contract
- Input: email (string, valid format), password (string, min 8 chars)
- Output on success: token (JWT string), user (id, email, created_at)
- Errors: 401 invalid credentials, 429 rate limit exceeded

## invariant
- Password is never stored in plaintext
- Failed login attempts are logged with IP and timestamp
- Token expiry is always ≤ 24 hours

## test
- Given valid credentials → return 200 with token
- Given invalid email format → return 400
- Given rate limit exceeded → return 429 after 5 failed attempts in 60s

## constraint
- Response time < 200ms at p95
- Supports up to 1000 concurrent login requests

## deferred
- OAuth provider integration (decided next iteration)

## Layers

### L0 — Mock Auth Endpoint
**Goal:** Working HTTP endpoint that accepts login requests and returns a fixed token
**What works:** POST /auth/login with any valid-format email/password → 200 with mock JWT
**What's mocked:** Password verification (always succeeds), user lookup (returns fixed user object)
**Definition of Done:**
- [ ] Lint check: `npm run lint`
- [ ] Endpoint responds to POST /auth/login with 200 and a JWT-like string
- [ ] System starts without errors: `node src/server.js`

### L1 — Real Authentication
**Goal:** Replace mocks with actual password hashing and user lookup
**What changes:** bcrypt comparison replaces "always succeeds"; database query replaces fixed user object
**Prerequisite:** Layer 0 complete and passing
**Definition of Done:**
- [ ] All L0 tests still pass (regression)
- [ ] Valid credentials return 200 with real JWT signed using project secret
- [ ] Invalid credentials return 401

### L2 — Security & Rate Limiting
**Goal:** Add brute-force protection and security headers
**What changes:** Rate limiter on /auth/login, account lockout after N failures, security headers
**Prerequisite:** Layer 1 complete and passing
**Definition of Done:**
- [ ] 5 failed attempts in 60s → 429 response
- [ ] Security headers present in all responses
