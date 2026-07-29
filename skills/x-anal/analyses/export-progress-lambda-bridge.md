# Analysis — export-progress-lambda-bridge

**Date:** 2026-07-28 14:30
**User Intent:** Add real-time export progress reporting to the Lambda (AWS) export worker, matching what the fly.io worker already does. The fly.io worker writes `progress_pct` + `current_step` to Postgres via Supabase admin client with throttled updates (~1.5s), enabling push-based UI updates through Supabase realtime channels.

**Environment:** AWS Lambda (Node.js 20) for video export, Supabase Postgres as DB, frontend uses `useExportRealtime` hook subscribing to `exports_progress:{id}` channel.

---

## Thesis

Progress reporting can be added to the Lambda worker by wiring existing Supabase admin credentials into the export function construct and adding a throttled write call in the ffmpeg progress callback — no new infrastructure needed since the bridge (Supabase client + secret + updater utility) already exists for other job types.

## Evidence

| # | Observation | Proof |
|---|------------|-------|
| 1 | The Lambda export function **cannot** currently reach Postgres — it lacks `SUPABASE_SECRET_ARN` and the corresponding IAM grant in CDK. | `export-function.ts:52-72`: environment only has R2 secret; no Supabase credentials wired. Contrast with `media-worker-function.ts:56,74` which passes `SUPABASE_SECRET_ARN` and calls `supabaseSecret.secret.grantRead(this.fn)`. |
| 2 | The **Supabase admin client** already works in the Lambda worker for other job types (main media handler). It lazy-initializes from env vars populated by Secrets Manager. | `src/supabase/client.ts:13-30`: singleton `getSupabaseAdmin()` reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; initialized via `initSupabaseCredentials()` at cold start in `media-worker-function`. |
| 3 | The **update utility** (`updateExportStatus()`) already exists and accepts any partial patch — no new code needed there. | `src/supabase/updaters.ts:8-13`: takes exportId + patch, calls `_updateRow` which uses the admin client. |
| 4 | Progress data is **already being parsed** from ffmpeg stderr in the Lambda worker but only logged to CloudWatch — not persisted. | `export-handler.ts:408-415`: `onProgress` callback logs `{ progress_pct }` but never calls any updater. |
| 5 | The fly.io worker uses a **StageReporter** with throttled writes (~1.5s) and monotonic percentage tracking. | `synetic-media-worker/src/export-progress.ts:32,74-89`: `WRITE_THROTTLE_MS = 1500`, `writeNow` updates `progress_pct` + `current_step`. |
| 6 | Frontend **already supports** push-based progress via Supabase realtime channel. No UI changes needed for the bridge. | `use-export-realtime.ts:117-132`: subscribes to `exports_progress:{exportId}` and listens for `postgres_changes` on the `exports` table. Falls back to 3s polling if websocket fails. |

## Confidence Level

**high** — The Supabase client, secret infrastructure, updater utility, and frontend realtime subscription all already exist. The only missing piece is wiring credentials into the export function CDK construct + adding a throttled write in the progress callback.

---

## Solution Proposition

### Option A: Direct Supabase writes (recommended)

**What:** Wire `SUPABASE_SECRET_ARN` into the export function, initialize Supabase client at cold start, add throttled `updateExportStatus()` calls in the `onProgress` callback and stage transitions.

**Where:**
- `infra/aws/cdk/lib/constructs/export-function.ts:39,45-48` — Add supabaseSecret prop + env var + IAM grant + secret read permission
- `synetic-media-worker-aws/src/export-handler.ts:15` — Call `initSupabaseCredentials()` at module load (with same pattern as `initSentry()`)
- `synetic-media-worker-aws/src/export-handler.ts:408-415` — Replace log-only onProgress with throttled write using existing updater

**Risk:** low — reuses existing infrastructure, no new services. The only risk is Lambda cold starts if credentials aren't initialized before the progress callback fires (mitigated by initializing at module load like Sentry).

**Effort:** small (~30 min) — Add CDK wiring, one init call, one throttled write function.

### Option B: SNS fan-out to backend updater

**What:** Lambda publishes progress events to SNS; a separate Lambda/HTTP handler receives them and updates Postgres. Decouples export worker from DB writes.

**Where:**
- New SNS topic + subscriber Lambda in `media-worker-stack.ts`
- New SQS/SNS event source for the subscriber
- Export function publishes to topic instead of writing directly

**Risk:** medium — introduces new moving parts (SNS topic, subscriber Lambda), increases latency, adds operational complexity.

**Effort:** large (~2-3 hours) — New CDK construct, new handler, testing the full chain.

### Option C: DynamoDB Streams as event source

**What:** Export Lambda writes progress to a DynamoDB table; Stream triggers an update function that patches Postgres.

**Where:**
- New DynamoDB table in CDK
- Stream + trigger Lambda for DB sync
- Export handler writes to DDB instead of directly to Supabase

**Risk:** medium-high — adds DynamoDB as new dependency, introduces eventual consistency (stream → trigger → update = seconds of delay), more complex than Option A.

**Effort:** large (~3 hours) — New table, stream config, trigger Lambda, error handling for failed syncs.

---

## Decision

**Option A is strongly recommended.** The bridge already exists in the codebase — other job types (transcode, proxy generation) already use it successfully through `media-worker-function.ts`. Adding it to the export function is a matter of:

1. Passing `supabaseSecret` into `ExportFunctionProps`
2. Adding env var + IAM grant in CDK
3. Calling `initSupabaseCredentials()` at module load
4. Throttling progress writes (avoid hammering DB from every ffmpeg stderr line)

No new infrastructure, no architectural change, and the frontend realtime subscription already works end-to-end once data reaches Postgres.

## Next Steps

1. Update `export-function.ts` CDK construct to accept + use Supabase credentials
2. Add `initSupabaseCredentials()` call in `export-handler.ts`
3. Replace log-only progress callback with throttled `updateExportStatus()` calls
4. Consider adding stage-based step labels ("Downloading…", "Encoding…") matching fly.io worker's `current_step` field for richer UI feedback
