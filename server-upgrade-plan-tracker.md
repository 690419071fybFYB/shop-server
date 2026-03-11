# hioshop-server Upgrade Plan Tracker

Date: 2026-03-11 (Asia/Shanghai)
Scope: `hioshop-server` only
Strategy: incremental and backward-compatible

## Batch 1: Security baseline (Highest priority)

- [x] API default-deny auth gate with allowlist and stable `401` fallback
- [x] Unified order ownership checks on critical write paths (cross-account => `403`)
- [x] Test payment endpoint default closed and production-isolated
- [x] JWT moved to env secrets with expiry and legacy verification compatibility window

## Batch 2: TDD and regression gate

- [x] Added security regression test script (`scripts/test-security-regression.js`)
- [x] Added reusable npm gate entry (`test:security-regression`, `test:pr-gate`)
- [x] Updated coupon test script to secure env-secret usage
- [x] Run full regression in a provisioned env (`compile + lint + coupon + security + full testing/ chain`)
- [x] Added GitHub Actions gate workflow (`.github/workflows/server-pr-gate.yml`) with Node 20 + MySQL seed + `npm run test:pr-gate`

## Batch 3: coding-standards refactor

- [x] Extracted reusable auth/route helper methods in API base controller
- [x] Reduced repeated login/ownership check branches in order controller
- [x] Normalized forbidden/unauthorized error semantics on write paths
- [x] Runtime hardening baseline: Docker production entry + deterministic `src -> app` emit in image
- [x] Request auth context isolation: remove `think.userId/think.token/think.adminAuth` request carrier usage in `src`
- [x] Service extraction (controller slimming): order submit transaction down to `api/service/order.js`, cart decorate down to `api/service/cart.js`, admin goods HTTPS asset upload down to `admin/service/goods_asset.js`
- [x] Added auth-context concurrency regression script (`scripts/test-auth-context-isolation.js`) and gate command `test:auth-context-isolation`
- [x] Optional small-function refactor for `order.submit/detail`: extracted local helpers (login/time/计数/打印文案), removed duplicate branches, and fixed empty `postscript` edge handling
- [x] Order number consistency hardening: unified `order_sn` generator in common util (`YYYYMMDDHHmmss + 6`), fixed month/day fields, and added 3-attempt duplicate retry in API order creation + admin order-sn rewrite paths

## Required envs for gate execution

- `API_JWT_SECRET` (or compatibility alias `API_TOKEN_SECRET`)
- `ADMIN_JWT_SECRET` (or compatibility alias `ADMIN_TOKEN_SECRET`)
- DB/test envs for integration scripts (host/port/user/password/name)
- local template is now tracked in `.env.example`; local runtime file `.env.local` is auto-loaded by `development.js` / `production.js` and test scripts

## Recommended next execution order

1. Keep CI bound to Node 20 + ESLint 9 flat config.
2. In GitHub branch protection, mark check `server-pr-gate / pr-gate` as Required before merge.
3. Keep local `.env.local` test secrets in sync with `deploy/.env` (or inject via CI secrets) to avoid false-negative DB/auth regression failures.
4. Track and close non-blocking Sass deprecation warnings in `hioshop-admin-web`.
