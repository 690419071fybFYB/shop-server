# hioshop-server Review Report

Date: 2026-03-11 (Asia/Shanghai)
Reviewer mode: `coding-standards` + `tdd-workflow` + `security-review`

## Summary

This round completed a server-only hardening and maintainability upgrade focused on authentication defaults, order ownership enforcement, test-payment isolation, JWT security, and security regression testing hooks.

## Findings Mapping

| Finding ID | Risk | Status | Evidence |
| --- | --- | --- | --- |
| HR-001 | Order write-path IDOR | Fixed | `src/api/controller/order.js` adds `ensureOwnedOrder(...)`; cross-account write now fails `403` for `cancel/delete/confirm/update/complete/express`. |
| HR-002 | Test pay endpoint exposed | Fixed (default closed) | `src/api/controller/pay.js` keeps endpoint closed unless explicit `ENABLE_TEST_PAY_ENDPOINT=true` and non-production guard passes. |
| HR-003 | API auth not uniformly enforced | Fixed/verified | `src/api/controller/base.js` applies centralized allowlist with default deny (`401`) and reusable auth helpers. |
| HR-004 | JWT secret hardcoding / no expiry | Fixed + compatibility window | `src/common/config/config.js`, `src/api/service/token.js`, `src/admin/service/token.js` now use env secrets, expiry, and optional legacy-secret verification window. |

## Code Quality Upgrades

- Introduced reusable controller helpers in `src/api/controller/base.js`:
  - `requireLoginUserId()`
  - `failUnauthorized()`
  - `failForbidden()`
  - route/config list normalization helpers
- Reduced repeated login checks and duplicated ownership checks in order write actions.
- Tightened address ownership validation in `order.submitAction` (`addressId` must belong to current user).
- Added config parity for previously expected public route `settings/showsettings` in `src/api/config/config.js`.

## Security/Test Infrastructure Upgrades

- Added security regression script: `scripts/test-security-regression.js`
  - verifies `401` on unauthenticated protected API
  - verifies `403` on cross-account order write
  - verifies test-pay endpoint is `404` by default
  - verifies expired token rejection (`401`)
  - optionally verifies legacy JWT secret compatibility (when provided)
- Added npm commands in `package.json`:
  - `test:security-regression`
  - `test:pr-gate`
- Updated `scripts/test-coupon.js` to require env-based JWT secrets (removed insecure hardcoded defaults).

## Environment and Dependency Upgrades

- Added dotenv-based env bootstrap:
  - `development.js` / `production.js` auto-load `.env.local` and `.env`.
  - `.env.example` added as committed template.
  - `.gitignore` now protects `.env*` (except `.env.example`).
- Migrated lint governance to ESLint 9 Flat Config:
  - `eslint.config.cjs`
  - lint commands cover `src/`, `scripts/`, and bootstrap entry files.
- Upgraded runtime to ThinkJS 4 alpha with Node 20 baseline and removed Babel startup chain:
  - `thinkjs@4.0.0-alpha.0`
  - `bootstrap.js`, `scripts/compile.js`, updated Dockerfile runtime.
- Upgraded security-relevant runtime dependencies:
  - `bcryptjs@^3.0.3`, `mime-types@^3.0.2`
- Removed unused dependencies to reduce supply-chain surface:
  - `nanoid`, `pinyin` (and deleted dead `pinyin` import in `src/api/controller/cart.js`)

## Residual Risks / Follow-ups

- ThinkJS 4 alpha is intentionally accepted for production cutover; maintain rollback discipline with baseline artifacts.
- Full integration runs depend on provisioned DB/runtime env (`deploy/.env`) and should remain part of CI/nightly.
- Out of this scope: admin SSRF hardening and admin password hash migration track.

## Architecture Optimization Follow-up (2026-03-11)

- Docker/runtime consistency:
  - `Dockerfile` switched to `npm run start:prod`.
  - image build now runs `node scripts/compile.js --emit-app` to avoid stale local `app/` drift.
  - `.dockerignore` excludes `app/` and `.env*`.
- Request context isolation:
  - removed request-time identity carrier globals (`think.userId`, `think.token`, `think.adminAuth`) in `src` path.
  - identity and auth context now flow through `ctx.state`.
- Controller-to-service slimming:
  - extracted order submit transaction/persistence into `src/api/service/order.js`.
  - extracted cart response decoration into `src/api/service/cart.js`.
  - extracted admin goods HTTPS asset upload orchestration into `src/admin/service/goods_asset.js`.
- Security + ops hardening:
  - `api_error_guard` now emits request ID and hides internal error details in production responses.
  - third-party logistics config placeholders removed from source config and switched to env-driven values.
  - added concurrency regression gate script: `scripts/test-auth-context-isolation.js`.

## Continuation Notes (2026-03-11)

- Controller micro-refactor (behavior-preserving):
  - `src/api/controller/order.js` extracted local helpers for repeated logic:
    - `requireUserIdOrAbort()`
    - `getCurrentUnixTime()`
    - `sumGoodsCount()`
    - `buildOrderPrintInfo()`
    - time/base64 formatting helpers
  - normalized repeated login checks and removed dead counting branches.
  - fixed `submitAction` edge case: empty/undefined `postscript` no longer risks runtime failure during `Buffer.from(...)`.
- Dependency hygiene:
  - removed unused `pinyin` package from `package.json` / lockfile.
  - bumped `lodash` to stable `^4.17.23`.
- Local gate reliability:
  - synchronized local test env keys with deploy runtime (`JWT + DB + Weixin signing` set) so `test:pr-gate` can run end-to-end without manual env injection.
- CI gate enforcement:
  - added GitHub Actions workflow `.github/workflows/server-pr-gate.yml`.
  - workflow provisions MySQL 8, imports `hiolabsDB.sql`, starts server in production mode, then executes `npm run test:pr-gate` under Node 20.
- Order number consistency hardening:
  - added shared generator `src/common/utils/order_sn.js` and unified API/Admin model `generateOrderNumber()` to same 20-digit format (`YYYYMMDDHHmmss + 6 random`).
  - fixed historical date-field bug (`getMonth()+1`, `getDate()`), removing old `getDay()` misuse risk.
  - added bounded duplicate retry (`maxRetries=3`) with warning/error logs in:
    - `src/api/service/order.js` (order create transaction)
    - `src/admin/controller/order.js` (order_sn rewrite paths including reprint/update flows)
  - duplicate retry only triggers on `ER_DUP_ENTRY` + `order_sn` key; non-order_sn collisions fail fast with original error.
