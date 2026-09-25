# Spec — API rate limiting

The API should have rate limiting so that it stays fast and is not abused.

## Requirements
- Rate limiting must be fast and not slow down requests.
- Heavy users should be limited, normal users should not notice.
- When a user is limited they should get an appropriate error.
- It should scale to lots of users.
- Limits should be configurable.
