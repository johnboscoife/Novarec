# ADR 0002 — Dependency version strategy: latest stable, minus two deliberate holds

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 0

## Context

The spec says use "latest stable" and also "prefer boring, well-supported
libraries … this app handles people's unrecoverable work." At scaffold time the
registry offered some brand-new majors whose ecosystems have not caught up.
Peer-dependency constraints, not preference, decided two of them.

## Decision

Adopt current stable majors across the stack, with **two deliberate holds**:

### Hold 1 — TypeScript stays on 5.9.x (not the 7.x native compiler)

`typescript-eslint@8.65` — the current release — declares
`typescript: ">=4.8.4 <6.1.0"`. It cannot lint a TypeScript 7 program. Since our
"no `any`, strict everywhere" posture depends on typescript-eslint, TS 7 would
mean **no linting**. We hold at TypeScript **5.9.3** (latest supported) until
typescript-eslint (and electron-vite/tsx) declare TS 7 support. Revisit then.

### Hold 2 — Vite 7, not Vite 8

`electron-vite@5` supports `vite: ^5 || ^6 || ^7`. `@vitejs/plugin-react@6`
requires `vite: ^8`. These are mutually exclusive. We standardize the renderer
on **Vite 7.3** with **@vitejs/plugin-react 5.2** (which spans vite 4–8). Vitest
4 and `@tailwindcss/vite` 4.3 both accept Vite 7, so the whole renderer/test
toolchain shares one Vite. Revisit Vite 8 when electron-vite adds support.

### Adopted at current major

- Electron 43, electron-builder 26, electron-updater 6.8
- React 19.2, @tanstack/react-query 5, zustand 5
- **Zod 4** — core to all validation; stable and current. One code change:
  `createdAt` uses `z.string()` rather than the moved/renamed `.datetime()`
  string-format API, keeping the schema version-agnostic.
- Fastify 5.10, ESLint 10, typescript-eslint 8.65, Vitest 4, Playwright 1.61,
  Tailwind 4.3, commitlint 21, lint-staged 17

## Consequences

- Two known upgrade tasks are tracked (TS 7, Vite 8), each unblocked by a
  specific upstream release rather than by us.
- CI pins Node 22 and pnpm 9.15; `pnpm-lock.yaml` is committed so the resolved
  set is reproducible across the three-platform matrix.

## Alternatives considered

- **Force TS 7 + skip type-aware lint** — rejected; linting is a hard
  requirement, and TS 7 is too fresh for an app guarding unrecoverable work.
- **Force Vite 8 + plugin-react 6** — rejected; electron-vite would be on an
  unsupported Vite, defeating the point of a stable base.
