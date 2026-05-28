# Subagents View — Implementation Plan v2 (backend + frontend)

> **Supersedes** `2026-05-28-subagents-view-plan.md`. That plan assumed subagent
> child events already reach the frontend and only the frontend needed changes.
> **That assumption is false** and was disproven three ways (code, live SSE
> capture, DB). Child events are dropped in the **backend** and never reach the
> browser. This v2 adds the required backend work and corrects several
> load-bearing frontend assumptions.

> **For agentic workers:** Execute task-by-task with
> superpowers:subagent-driven-development. Backend tasks land first (they
> produce the data the frontend consumes), then frontend, then E2E.

**Goal:** Make subagent activity visible in Craft — an agent strip above the
input shows live subagent status; clicking a pill opens that subagent's
transcript as a transient side-panel tab.

**Spec:** `docs/craft/features/subagents/2026-05-28-subagents-view-design.md`
(the design's *surfaces* are correct; its "no backend changes / persistence via
the `tool_call` table" claims are wrong — see Important Notes).

**Prerequisite:** universal-panel refactor — already present on this branch
(`PanelTab`, `panelTabId()`, `panelTabs`, `activePanelTabId`,
`setActivePanelTabId`, `openFilePreview`, `closeFilePreview`,
`tabHistory`/`TabHistoryEntry`).

---

## Issues to Address

When the Craft agent dispatches a subagent via the `task` tool, the transcript
shows one card with the prompt and the subagent's final summary. The subagent's
intermediate tool calls are invisible. This hurts (1) **trust** — a 30s+
subagent looks frozen — and (2) **debuggability** — a wrong answer can't be
inspected. Give users a peripheral indicator of running subagents and a fast way
to open any subagent's live transcript, without disrupting the main chat.

---

## Important Notes (verified ground truth — read before coding)

### Backend (the part the original plan missed)

- **Child events DO reach the per-pod event bus, then get dropped.** Verified
  live: dispatching one subagent produced **47 child-session events** at
  `PodEventBus._dispatch`, including a full `bash` tool lifecycle
  (`pending → running → completed`, with input + output/exit). They are dropped
  at **two** points:
  1. `event_bus.py` `_dispatch` (~line 282-299) enqueues an event only to
     subscribers keyed by the event's **own** `sessionID`. A turn subscribes to
     the **parent** session only (`serve_client.py` `send_message` ~line 990:
     `self._event_bus.subscribe(opencode_session_id)`), so child events are
     never delivered to the turn's consumer.
  2. `serve_client.py` `translate_opencode_event` (~line 375-376):
     `if sess_id is not None and sess_id != state.session_id: return  # event
     for another session (e.g. subagent child)`.
- **The event bus already tracks parent↔child.** `_dispatch` reads
  `session.created` and populates `_child_to_parent` / `_parent_to_children`;
  `list_children(parent)` and `parent_of(child)` expose them (currently **zero
  callers**). One level deep is all the spec needs.
- **Child spawn shape** (`session.created`): `properties.sessionID` = child id;
  `properties.info.parentID` = parent id; `properties.info.title` =
  `"… (@<subagent_type> subagent)"`; child `directory` == parent's.
- **Child tool event shape** = `message.part.updated` with `properties.part`
  `{type:"tool", tool, callID, state:{status,input,output,metadata}, id,
  sessionID, messageID}` — **identical** to parent tool parts, so the existing
  `_emit_tool_events(part, state)` already knows how to translate it.
- **Carry routing via the ACP `_meta` field — no schema change.** Every ACP
  event (`acp/schema.py`, base model ~line 39-45) has
  `field_meta: Optional[Dict[str, Any]]` aliased `"_meta"`. It survives
  `model_dump(mode="json", by_alias=True)`, which is what both the SSE serializer
  (`manager.py` `_serialize_sandbox_event` ~1228-1238) and the persistence path
  (`_persist_sandbox_event` ~1536-1584) already use. Populate
  `_meta = {"sessionId": <child>, "parentSessionId": <parent>}` on translated
  child events; it reaches the frontend and the DB unchanged.
- **The `task` tool's `rawInput` does NOT contain the child session id.**
  Verified: it is `{description, prompt, subagent_type}`. The original plan's
  `TaskBody` extraction (`rawInput.session_id`) is wrong. Link the parent `task`
  card → child transcript by **tagging the parent `task` tool event's `_meta`
  with the child `sessionId`** (resolve via `parent_of`/`list_children` at
  translate or persist time), and/or by matching `SubagentState.parentToolCallId`
  in the store.
- **Persistence is `build_message` JSON, not the `tool_call` table.** Build
  sessions persist each event as a `build_message` row with the full packet in
  `message_metadata` (`backend/onyx/db/models.py:5389+`,
  `build/db/build_session.py:create_message`). The design's reference to
  `tool_call.parent_tool_call_id` (models.py:2911) is the **wrong table** — no
  migration is relevant. Child tool events persist the same way once forwarded,
  with `_meta` carrying routing.

### Translation caveats (scope the backend change carefully)

- `_emit_tool_events` does **not** depend on `_is_assistant_message`, so child
  **tool** parts translate cleanly. Child **text/reasoning** parts go through
  `_is_assistant_message`, which hydrates via `fetch_message` bound to the
  **parent** session → a child message id would 404. The feature needs the
  child's **tool calls**; treat child text/reasoning as out of scope for v1
  (drop or best-effort), and do not let a child 404 disrupt the parent stream.
- `_TurnState` tracking dicts are keyed by unique `partID`/`callID`, so routing
  parent + child parts through one `state` does not collide. Keep it simple:
  one parent-turn consumer that also sees child events.

### Frontend (corrected assumptions)

- `ToolCallState` uses **`id`**, not `toolCallId` (`displayTypes.ts:66-88`).
- Imports actually used in craft: `Text`, `Tag` from `@opal/components`; icons
  (`SvgBubbleText`, `SvgX`, `SvgChevronDown`) from `@opal/icons`; `cn` from
  `@opal/utils`. (`web/CLAUDE.md` says `@/icons`, but the craft module uses
  `@opal/icons` throughout — follow the local convention and keep imports
  consistent with neighboring files.)
- `PanelTab` is `{ kind: "file"; path; fileName }` and `panelTabId()` uses an
  exhaustive `default` that throws — adding `kind:"subagent"` means adding a
  `case` (don't leave it hitting the `default`).
- `openFilePreview`/`closeFilePreview`/`setActivePanelTabId` (store ~1635-1808)
  are the exact templates for the subagent equivalents (same `tabHistory`
  push pattern, `TabHistoryEntry = {type:"panel-tab", tabId}`).
- Streaming: `useBuildStreaming.ts` dispatches each `parsePacket` result via
  store actions keyed by an explicit `sessionId` arg. Historical load runs the
  **same** `parsePacket` via `convertMessagesToStreamItems` (store ~54-144,
  `loadSession` ~1168-1287) — so one classification helper serves both paths.
- `CraftToolCard` props: `{ toolCall: ToolCallState; defaultOpen?; dense? }`.

---

## Implementation strategy

Backend → frontend → tests. Each task ends in type-check / syntax-check +
commit. The backend dev loop here is `uvicorn --reload` (telepresence intercept
of `onyx-api-server` → local backend), so backend edits hot-reload; verify each
with a real subagent dispatch + the browser SSE tee.

### Backend

**B1 — Deliver descendant events to the ancestor turn's subscriber.**
`event_bus.py` `_dispatch`: after resolving `sid`, if `sid` has a parent
(`_child_to_parent`), also enqueue the event to the subscribers of its root
ancestor (one level per spec; resolve via `parent_of`). Keep delivery to the
child's own subscribers too (harmless). Hold `_lock` consistently. Net effect:
the parent turn's consumer now receives child events.

**B2 — Translate-and-tag child events instead of dropping them.**
`serve_client.py` `translate_opencode_event`: when `sess_id != state.session_id`
but `sess_id` is a descendant of `state.session_id`, do **not** return. For
`message.part.updated` tool parts, translate via the existing `_emit_tool_events`
and set `field_meta = {"sessionId": sess_id, "parentSessionId":
state.session_id}` on each yielded event. Drop child text/reasoning for v1
(avoid the parent-bound `fetch_message` 404). `translate_opencode_event` needs
the parent↔child relationship — pass the bus (or a `child→parent` lookup /
descendant predicate) into the call (it already receives `state`; thread a
resolver through `_consume_from_bus` → `send_message`, which holds the bus).

**B3 — Tag the parent `task` tool event with its child session id.**
So the frontend can link the `task` card and the agent strip to the subagent.
At translate (or in `_persist_sandbox_event`), when emitting the parent's `task`
`ToolCallProgress`, resolve its child via `list_children(parent)` (most-recent /
by spawn order, correlated to the task call) and set
`field_meta = {"subagentSessionId": <child>}`. If correlation is ambiguous with
parallel tasks, fall back to matching on spawn order; note any limitation via
`log`. Persistence + SSE carry `_meta` automatically.

**B4 — Confirm persistence + SSE carry `_meta` for child tool calls.**
`_persist_sandbox_event` already persists `ToolCallProgress` with
`status=="completed"` via `model_dump(by_alias=True)`; confirm child tool events
(now forwarded) persist as `build_message` rows with `_meta` populated, and that
`_serialize_sandbox_event` emits `_meta` on the SSE line. Add child-event
persistence only if the existing branch doesn't already cover it. **Verify with
the DB query** for `message_metadata->'_meta'->>'parentSessionId'`.

### Frontend

**F1 — Surface `_meta` routing on parsed packets.**
`packetTypes.ts`: add `sessionId: string | null` and
`parentSessionId: string | null` to `ParsedToolCallStart` /
`ParsedToolCallProgress` (and `subagentSessionId` for the parent task event).
`parsePacket.ts`: read them from the raw packet's `_meta`
(`p._meta?.sessionId`, `p._meta?.parentSessionId`,
`p._meta?.subagentSessionId`). Keep existing `subagentType` extraction.

**F2 — `SubagentState` + `subagents` store slice + `PanelTab` extension.**
`displayTypes.ts`: add `SubagentStatus`, `SubagentState` (keyed by child
session id; holds `toolCalls: ToolCallState[]`, `status`, `subagentType`,
`name`, `parentToolCallId`, timestamps), and extend `PanelTab` with
`{ kind:"subagent"; subagentSessionId }` + a `panelTabId` `case`.
`useBuildSessionStore.ts`: add `subagents: Map<...>` to `BuildSessionData` (+
initial value), selectors `useSubagents` / `useSubagent`. Use `ToolCallState.id`.

**F3 — Store actions:** `openSubagentInPanel` (mirror `openFilePreview`),
`recordSubagentToolCall`, `markSubagentComplete`, and a generic
`closePanelTab` (mirror `closeFilePreview`, filter by tab id).

**F4 — Route events by `_meta` (SSE + historical load).**
`useBuildStreaming.ts`: add `classifyPacket(parsed, parentSessionId)` →
parent | `{subagent, sessionId}` using `parsedevent.parentSessionId === parent
&& sessionId !== parent`. Route child events to `recordSubagentToolCall`
(build `ToolCallState` the same way the parent path does), and detect child
completion → `markSubagentComplete`. When the parent `task` event arrives, seed
the `SubagentState` (name from prompt/`info.title`, `subagentType`,
`parentToolCallId = task.id`, `subagentSessionId` from `_meta`). Apply the same
classification in `convertMessagesToStreamItems` so reload reconstructs
subagents.

**F5 — `SubagentTab` body** (`output-panel/SubagentTab.tsx`): render
`useSubagent(id).toolCalls` via `CraftToolCard`, with a header (type badge +
name + status/step count).

**F6 — `OutputPanel` wiring:** add the `kind:"subagent"` `case` to the
tab-row chrome (badge instead of file icon) and the body switch
(`<SubagentTab>`); route `handlePanelTabClose` through `closePanelTab`.

**F7 — `AgentPill` + `AgentStrip`** and mount `AgentStrip` above `InputBar` in
`ChatPanel.tsx` (the former `ConnectorBannersRow` slot). Strip returns `null`
when no subagents. Running-first sort; click → `openSubagentInPanel`.

**F8 — Slim `TaskBody.tsx`:** badge + prompt + live step count + result; clicking
calls `openSubagentInPanel(subagentSessionId)`. Resolve the child id from the
task tool's `_meta.subagentSessionId` (NOT `rawInput.session_id`); fall back to
the `subagents` entry whose `parentToolCallId === toolCall.id`.

---

## Tests

- **Playwright E2E** (`web/tests/e2e/craft-subagents-view.spec.ts`): drive a
  subagent dispatch; assert (1) `task` card with live status, (2) `AgentStrip`
  pill appears, (3) clicking opens a `kind:"subagent"` panel tab and renders the
  child's tool calls, (4) main chat stays visible, (5) closing the tab keeps the
  pill, (6) reload restores the strip from `build_message`, (7) completion shows
  done + final step count. The model/onboarding setup is fiddly in this env;
  if a live agent isn't runnable in CI, drive the store via SSE/API mocking the
  way `craft-side-panel.spec.ts` does, injecting child `tool_call_progress`
  events whose `_meta` carries `{sessionId, parentSessionId}`.
- **Backend external-dependency unit test** (optional, high value, cheap):
  `translate_opencode_event` is a pure function — feed it a captured child
  `message.part.updated` tool event (sample in this doc / `/tmp` dump from the
  spike) with a parent `state`, assert it yields a `ToolCallProgress` with
  `field_meta == {"sessionId": child, "parentSessionId": parent}` and is not
  dropped. Also assert a non-descendant session is still dropped.

---

## Notes for the engineer

- **DRY:** subagent panel tabs reuse the `PanelTab` machinery; the `_meta`
  routing is one concept shared by SSE + persistence + reload.
- **YAGNI:** one level deep only (no subagent-of-subagent). No "back to main"
  affordance (main chat stays visible).
- **Don't break the parent stream:** child translation/forwarding must be
  failure-isolated — a child hiccup (e.g. `fetch_message` 404 on child text)
  must not interrupt the parent turn.
- **Verify, don't assume:** confirm `_meta` round-trips with the DB query and
  the browser SSE tee after B1-B4 before building the frontend on top.
