# ADR 0001 — Monorepo tooling: pnpm workspaces, electron-vite, source-only packages

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 0

## Context

NovaRec is one product with a shared core consumed by three front doors plus a
signaling server. We need a repository that keeps the core genuinely shared,
type-checks end to end, and can build installers on all three platforms.

## Decisions

### 1. pnpm workspaces (no Turborepo/Nx yet)

Coordinate packages with `pnpm -r` and `--filter`. The build spec says "prefer
boring, well-supported libraries"; a dedicated task runner is not yet earning
its complexity. Revisit if graph build times become painful — that would be its
own ADR.

### 2. Internal packages ship TypeScript source

`packages/*` expose `./src/index.ts` directly (no per-package build step). Vite
and electron-vite transpile them; `tsc --noEmit` type-checks them.

**Consequence:** anything that consumes an internal package at **runtime in a
Node context** must **bundle** it, not `require()` it — Node cannot load a `.ts`
file. This is why `electron.vite.config.ts` excludes `@novarec/*` from
`externalizeDepsPlugin` (they get bundled into `out/`). When a package later
needs to be `require`d at runtime unbundled, we add a `tsup` build for it (future
ADR).

### 3. `node-linker=hoisted`

Electron and electron-builder pack most reliably against a flat, npm-like
`node_modules`. Hoisted linking avoids pnpm-symlink packaging issues at the cost
of some strictness. Electron's binary postinstall is allowed via
`pnpm.onlyBuiltDependencies`.

### 4. electron-vite + electron-builder

electron-vite gives us a Vite pipeline for all three Electron targets (main,
preload, renderer) with HMR; electron-builder produces platform installers. Both
are the de facto standard for this stack.

### 5. TypeScript strictness beyond `strict`

`tsconfig.base.json` enables `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, and `verbatimModuleSyntax`.
ESLint makes `@typescript-eslint/no-explicit-any` an error. This app handles
unrecoverable work; the compiler should catch as much as possible.

### 6. Strict CSP via response header (not `<meta>`)

CSP is installed in `src/main/security.ts` through `onHeadersReceived`: strict in
production, loosened in development only for what Vite HMR requires. A header is
authoritative where a `<meta>` tag is not.

## Alternatives considered

- **Turborepo now** — deferred; not enough packages to justify it.
- **Externalize internal packages** — rejected; would require a build step per
  package or break runtime `require` of `.ts` source.
- **`node-linker=isolated` (pnpm default)** — better strictness, but higher risk
  on the electron-builder packaging path; revisit once packaging is proven.
