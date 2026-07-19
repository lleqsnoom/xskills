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
