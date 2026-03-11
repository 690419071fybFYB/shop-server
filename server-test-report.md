# hioshop-server Test Report

Date: 2026-03-11 (Asia/Shanghai)

## Executed commands and evidence

### 1) `npm run compile`

Status: PASS

### 2) `npm run lint`

Status: PASS

### 3) `npm run test:coupon`

Status: PASS

### 4) `npm run test:security-regression`

Status: PASS

### 5) Root PR gate

Command:

```bash
/Volumes/SAMSUNG/fyb/myProjects/testing/.venv/bin/python \
  /Volumes/SAMSUNG/fyb/myProjects/testing/run_pr_gate.py \
  --workspace /Volumes/SAMSUNG/fyb/myProjects
```

Status: PASS

Evidence:

- report: `/Volumes/SAMSUNG/fyb/myProjects/testing-artifacts/20260311-145030-pr-gate/pr-gate-report.md`
- summary: `total=27, passed=27, failed=0, skipped=0`

### 6) Root Nightly full

Command:

```bash
/Volumes/SAMSUNG/fyb/myProjects/testing/.venv/bin/python \
  /Volumes/SAMSUNG/fyb/myProjects/testing/run_nightly_full.py \
  --workspace /Volumes/SAMSUNG/fyb/myProjects
```

Status: PASS

Evidence:

- report: `/Volumes/SAMSUNG/fyb/myProjects/testing-artifacts/20260311-145030-nightly-full/nightly-report.md`
- summary: `total=291, passed=291, failed=0, skipped=0`

## Runtime notes

- `hioshop-server` container rebuilt from current branch and confirms ThinkJS runtime:
  - `ThinkJS version: 4.0.0-alpha.0`
- Gate execution used provisioned MySQL + JWT env in `deploy/.env`.
- `hioshop-server/.env.local` test keys are synchronized with current deploy runtime (`JWT + DB + Weixin sign`) for local gate consistency.

## Architecture Optimization Verification (2026-03-11)

### A) Docker production hardening

- Command: `cd /Volumes/SAMSUNG/fyb/myProjects/deploy && docker compose up -d --build server`
- Status: PASS
- Evidence:
  - server startup command now `npm run start:prod` (container log)
  - container env: `NODE_ENV=production`
  - image runtime check: `/app/.env.local` does not exist
  - runtime smoke: `GET http://127.0.0.1:8360/` => `200` with `{"errno":0,...}`

### B) Request context isolation regression

- Command: `npm run test:auth-context-isolation`
- Status: PASS
- Evidence:
  - concurrent A/B token reads (`/api/cart/index`) keep correct `cartTotal.user_id`
  - concurrent own-order confirms succeed
  - concurrent cross-account confirms stable `403`

### C) Security regression after context migration

- Command: `npm run test:security-regression`
- Status: PASS

### D) Coupon script under current deploy env

- Command: `npm run test:coupon`
- Status: PASS
- Evidence:
  - `deploy/.env` now provides `WEIXIN_PARTNER_KEY`.
  - server container env check confirms `WEIXIN_PARTNER_KEY` is set.
  - coupon regression script runs green under current deploy runtime.

### E) Continuation gate after order-controller micro-refactor

- Command: `npm run test:pr-gate`
- Status: PASS
- Evidence:
  - compile: PASS
  - lint: PASS
  - coupon: PASS
  - security-regression: PASS
  - auth-context-isolation: PASS

### F) Order number consistency & retry regression

- Command: `npm run test:order-sn-regression`
- Status: PASS
- Evidence:
  - validates 20-digit `order_sn` format and date prefix correctness (`YYYYMMDDHHmmss`).
  - deterministic retry scenarios:
    - duplicate twice then success on third attempt.
    - duplicate all three attempts then fail with error log.
    - non-`order_sn` duplicate does not retry.
  - covers API service retry path and admin order_sn rewrite path via stubs/mocks.

### G) PR gate after order_sn integration

- Command: `npm run test:pr-gate`
- Status: PASS
- Evidence:
  - compile: PASS
  - lint: PASS
  - coupon: PASS
  - security-regression: PASS
  - auth-context-isolation: PASS
  - order-sn-regression: PASS
