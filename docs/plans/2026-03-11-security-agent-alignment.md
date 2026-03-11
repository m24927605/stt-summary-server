# Internal Security And Agent Alignment - Implementation Checklist

> **For Claude Code CLI:** Implement this plan exactly. Do not shrink scope, skip tests, or replace persistent controls with in-memory shortcuts.

## Execution Rules

1. Read the paired design first:
   - `docs/plans/2026-03-11-security-agent-alignment-design.md`
2. Implement in the phase order below.
3. Do not merge phases together if that makes review or testing ambiguous.
4. After each phase, run the phase-specific tests before moving on.
5. If any requirement in the design cannot be met, stop and document the blocker explicitly.

## Phase 0 - Baseline Review

### Objective

Confirm current code paths before editing.

### Required reading

1. `packages/server/src/plugins/session.ts`
2. `packages/server/src/routes/tasks.ts`
3. `packages/server/src/routes/events.ts`
4. `packages/server/src/logger.ts`
5. `packages/worker/src/consumer.ts`
6. `packages/worker/src/processors/llm.ts`
7. `packages/worker/src/services/storage.ts`
8. `terraform/iam.tf`
9. `terraform/ecs.tf`

### Done when

1. Existing entry points and responsibilities are understood.
2. No code is changed yet.

## Phase 1 - Shared Security Utilities

### Objective

Build the reusable primitives first so later phases do not duplicate logic.

### Required work

1. Create or refactor shared secret-pattern and redaction utilities if that reduces drift.
2. Ensure both server and worker can use equivalent deep redaction behavior.
3. Add worker output guard utility with the exact replacement string:

```text
[REDACTED: sensitive content removed]
```

4. Keep transcript sanitization separate from output guard.

### Files

1. `packages/server/src/logger.ts`
2. `packages/worker/src/logger.ts`
3. `packages/worker/src/utils/output-guard.ts`
4. optional shared utility path under `shared/`

### Required tests

1. `packages/server/src/__tests__/unit/logging-redaction.test.ts`
2. `packages/worker/src/__tests__/unit/output-guard.test.ts`
3. add worker logger redaction unit tests if none exist yet

### Done when

1. Nested arrays, nested objects, and serialized error objects are redacted in both server and worker.
2. Worker output guard covers all required patterns from the design.
3. Tests pass for both server and worker utilities.

## Phase 2 - Deterministic Summary Verification Pipeline

### Objective

Refactor summary generation so the worker no longer persists raw LLM output.

### Required work

1. Create `packages/worker/src/verification/summary-verifier.ts`.
2. Create `packages/worker/src/pipelines/secure-summary.ts`.
3. Move orchestration out of scattered files so the pipeline owns:
   - transcript sanitization
   - LLM generation
   - output guard
   - deterministic verification
4. Update consumer flow so only guarded and verified summary text can be persisted.
5. Add verification failure handling and internal failure classification.

### Files

1. `packages/worker/src/verification/summary-verifier.ts`
2. `packages/worker/src/pipelines/secure-summary.ts`
3. `packages/worker/src/processors/llm.ts`
4. `packages/worker/src/consumer.ts`
5. `packages/worker/src/utils/transcript-sanitizer.ts`

### Required tests

1. `packages/worker/src/__tests__/unit/summary-verifier.test.ts`
2. `packages/worker/src/__tests__/unit/secure-summary.test.ts`
3. update `packages/worker/src/__tests__/unit/llm-processor.test.ts`
4. update `packages/worker/src/__tests__/integration/consumer-process-task.test.ts`

### Done when

1. No raw summary is stored before output guard.
2. Verification failure prevents summary persistence.
3. Verification failure marks task as failed.
4. Tests cover number drift, empty output, secret-like output, and normal success.

## Phase 3 - Session Rotation And Ownership Migration

### Objective

Add 24-hour session rotation with atomic task ownership migration.

### Required work

1. Refactor session plugin into testable helper functions.
2. Add rotation threshold logic.
3. Implement transaction-based:
   - new session creation
   - `rotated_to` update
   - old session revoke
   - task ownership migration
   - cookie refresh
4. Ensure request continues under the rotated session in the same request cycle.
5. Ensure CSRF token is rotated with the session.

### Files

1. `packages/server/src/plugins/session.ts`
2. `packages/server/prisma/schema.prisma`
3. relevant Prisma migration files

### Required tests

1. `packages/server/src/__tests__/unit/session.test.ts`
2. `packages/server/src/__tests__/integration/security-stack.test.ts`
3. `packages/server/src/__tests__/integration/tasks-routes.test.ts`

### Done when

1. Rotation happens after 24 hours, not before.
2. Task ownership is migrated atomically.
3. New CSRF token is issued after rotation.
4. Old session is no longer valid.

## Phase 4 - Durable PostgreSQL Rate Limiting

### Objective

Replace process-local rate limiting with persistent database-backed limiting.

### Required work

1. Add Prisma model and migration for rate limit entries.
2. Implement reusable rate limit service with atomic increment/check.
3. Apply the service to all required task/session/event endpoints.
4. Add stale-row cleanup strategy.
5. Ensure request keying uses direct connection IP only.

### Files

1. `packages/server/prisma/schema.prisma`
2. new Prisma migration files
3. `packages/server/src/services/rate-limit.ts`
4. `packages/server/src/app.ts`
5. `packages/server/src/routes/tasks.ts`
6. `packages/server/src/routes/events.ts`

### Required tests

1. `packages/server/src/__tests__/unit/rate-limit.test.ts`
2. `packages/server/src/__tests__/integration/security-stack.test.ts`
3. endpoint integration tests proving limits are enforced

### Done when

1. Rate limits survive app rebuild/restart when using the same database.
2. Limits are per endpoint bucket as specified in the design.
3. No main enforcement path depends on in-memory maps.

## Phase 5 - Worker Streaming / Temp-File Safety

### Objective

Remove full-buffer S3 object download from the worker processing path.

### Required work

1. Inspect provider SDK requirements.
2. Choose stream or temp-file implementation according to the design decision rule.
3. Remove `transformToByteArray()` from the main path.
4. Ensure cleanup on success and failure.

### Files

1. `packages/worker/src/services/storage.ts`
2. `packages/worker/src/processors/stt.ts`
3. any provider adapter files that need path/stream support

### Required tests

1. unit or integration coverage for cleanup behavior
2. updated worker integration tests proving the new path works end-to-end

### Done when

1. Whole-object buffering is no longer the default processing path.
2. Cleanup is verified in tests.

## Phase 6 - Error Sanitization And API Compatibility

### Objective

Extend server-visible failure handling without breaking existing response shape.

### Required work

1. Extend `sanitizeTaskError()` to support:
   - `summary_verification_failed`
   - `processing_timeout`
   - `processing_failed`
2. Ensure REST and SSE paths use the sanitizer consistently.
3. Keep success response structure stable.

### Files

1. `packages/server/src/utils/error-sanitizer.ts`
2. `packages/server/src/routes/tasks.ts`
3. `packages/server/src/routes/events.ts`
4. response contract tests

### Required tests

1. `packages/server/src/__tests__/unit/error-sanitizer.test.ts`
2. `packages/server/src/__tests__/integration/events-routes.test.ts`
3. `packages/server/src/__tests__/contract/task-response-schema.test.ts`

### Done when

1. New failure categories are sanitized and exposed consistently.
2. No raw internal error string leaks to REST or SSE.

## Phase 7 - Terraform IAM Least Privilege Split

### Objective

Split server and worker runtime roles and reduce S3 permissions.

### Required work

1. Create separate ECS task roles for server and worker.
2. Give server runtime role only `s3:PutObject`.
3. Give worker runtime role only `s3:GetObject`.
4. Keep execution role separate for image pull, secrets, and logging.
5. Update ECS task definitions to use the correct task role per service.

### Files

1. `terraform/iam.tf`
2. `terraform/ecs.tf`

### Required validation

1. Terraform formatting and validation if available in repo workflow.
2. Manual review of generated policy scopes.

### Done when

1. Server and worker no longer share the same runtime task role.
2. Runtime S3 access is least privilege by service.

## Phase 8 - Frontend Compatibility Adjustments

### Objective

Keep frontend behavior correct after session rotation and new failure codes.

### Required work

1. Ensure `initSession()` handles rotated session bootstrap cleanly.
2. Ensure upload flow still works after session rotation.
3. Ensure new sanitized error codes/messages are surfaced correctly.
4. Do not introduce browser-stored auth state.

### Files

1. `packages/frontend/src/api.ts`
2. any affected frontend tests

### Required tests

1. `packages/frontend/src/__tests__/api.test.ts`
2. `packages/frontend/src/__tests__/App.test.tsx`
3. add or update tests for rotated session bootstrap if missing

### Done when

1. Frontend continues working without manual reload after normal session bootstrap.
2. Frontend handles sanitized failure states without assuming only old error codes exist.

## Phase 9 - Final Regression Pass

### Objective

Confirm the full change set works together.

### Required test suites

Run all relevant project tests, not just touched files.

At minimum:

1. server tests
2. worker tests
3. frontend tests if frontend code changed
4. Terraform validation/format checks if available

### Required reporting

Claude Code CLI must report:

1. which commands were run,
2. which suites passed,
3. any remaining known risk or deferred item.

### Done when

1. All relevant tests pass.
2. No required design item is left half-implemented.

## Mandatory Test Matrix

The implementation is incomplete unless all of the following behaviors are covered by automated tests:

1. Output guard redacts each required pattern.
2. Summary verifier rejects unseen numbers.
3. Summary verifier rejects secret-like output.
4. Secure summary pipeline stores only guarded summary.
5. Verification failure produces failed task state.
6. Session rotates after 24 hours.
7. Session rotation migrates task ownership.
8. New CSRF token is issued on rotation.
9. Durable rate limiter persists across app recreation with the same DB.
10. REST response sanitizes verification failure.
11. SSE response sanitizes verification failure.
12. Worker nested error logging is redacted.
13. Worker storage path does not rely on full-buffer download.
14. Terraform runtime roles are split correctly.

## Prohibited Shortcuts

Do not do any of the following:

1. Leave verification as TODO or stub returning success.
2. Keep raw LLM output in DB and only guard it at API response time.
3. Use in-memory rate limiting as the main implementation.
4. Rotate session cookie without migrating task ownership.
5. Reuse one broad task IAM role for both services.
6. Add untested behavior.
7. Skip integration tests because unit tests "already prove it".

## Suggested Delivery Order

Use this order unless a dependency forces a slight change:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8
9. Phase 9

## Final Completion Criteria

The task is complete only when:

1. the design requirements are implemented,
2. the checklist phases are complete,
3. the mandatory test matrix is covered,
4. relevant test suites are run and passing,
5. no prohibited shortcut was used.
