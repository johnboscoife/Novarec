# IPC Contract

All inter-process communication crossing the preload bridge is defined **once**
in [`packages/shared/src/ipc/contract.ts`](../packages/shared/src/ipc/contract.ts)
and validated with **Zod at both ends**.

## Rules

1. **One source of truth.** Every channel has a request schema and a response
   schema in `ipcContract`. Types are inferred from the schemas — never
   hand-written alongside them.
2. **Validate on the main side (non-negotiable).** The main-process handler
   parses the request with its Zod schema before doing anything with it.
3. **Validate on the renderer side (defense in depth).** The renderer parses the
   response before trusting it, so a contract drift fails loudly instead of
   corrupting UI state.
4. **Minimal preload surface.** The preload exposes explicit, named methods
   (`window.novarec.getInfo()`), never a generic `invoke(channel, payload)`.
5. **No `any`.** `IpcRequest<C>` / `IpcResponse<C>` derive the exact types.

## Shape

```ts
export const ipcContract = {
  'app:getInfo': { request: z.void(), response: AppInfoSchema },
  'app:ping': { request: PingRequestSchema, response: PingResponseSchema },
} as const;

export type IpcRequest<C extends IpcChannel> = z.infer<IpcContract[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.infer<IpcContract[C]['response']>;
```

## Flow

```
renderer                      preload                     main
────────                      ───────                     ────
window.novarec.ping(payload)
        │  ipcRenderer.invoke('app:ping', payload)
        └───────────────────────────────────────────────►  ipcMain.handle('app:ping')
                                                              PingRequestSchema.parse(raw)   ← validate request
                                                              …do work…
                                                              PingResponseSchema.parse(res)  ← validate response
        ◄───────────────────────────────────────────────
AppInfoSchema.parse(result)   ← renderer re-validates (defense in depth)
```

## Channels (Phase 0)

| Channel       | Request      | Response             | Purpose                            |
| ------------- | ------------ | -------------------- | ---------------------------------- |
| `app:getInfo` | _(none)_     | `AppInfo`            | App/runtime versions and platform. |
| `app:ping`    | `{ sentAt }` | `{ sentAt, pongAt }` | Liveness / round-trip probe.       |

Capture, record, meet, and studio channels are added in their respective phases,
each with request/response schemas registered here first.

## Adding a channel

1. Add the schemas + entry to `ipcContract` in `packages/shared`.
2. Register `ipcMain.handle(<channel>, …)` in `apps/desktop/src/main/ipc.ts`,
   parsing the request and response with their schemas.
3. Add an explicit method to `NovaRecApi` in `apps/desktop/src/preload/api.ts`
   and wire it in `preload/index.ts`.
4. Consume it from the renderer, parsing the response with its schema.
