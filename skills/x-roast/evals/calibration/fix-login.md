# Task — Fix the login bug

**Estimate:** 1 h, should be quick

Users say login is broken sometimes. bcrypt only uses the first 72 bytes of a password, so long
passwords are the likely cause. Switch password hashing from bcrypt to SHA-256, which has no length
limit, and rehash on next login.

## Done when
Login works.
