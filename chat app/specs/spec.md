# Spec: Saathi phase 1

## Objective

Saathi is a Humanitarian & Social Good web app for the Nexconn Build Challenge. A person in Indore requests practical help. A coordinator assigns a volunteer. Requester, volunteer, and coordinator coordinate in one Nexconn group channel until the request is complete.

Success for this version is the five-step journey, with real Chat SDK usage once Nexconn keys are present.

## Tech Stack

- React 18 + Vite + TypeScript for the web app
- Node HTTP server for sessions, requests, and Nexconn server API calls
- `@nexconn/chat` and `@nexconn/engine` 26.2.1
- JSON file at `data/store.json` for local demo state
- Nexconn data center default: Singapore (`https://api.sg-light-api.com`)

## Commands

Dev: npm run dev
Build: npm run build
Typecheck: npm run typecheck
Start: npm start

## Project Structure

- `server/` — session, request workflow, Nexconn signature and group APIs
- `shared/types.ts` — roles, request statuses, API shapes
- `web/src/` — member, volunteer, and coordinator screens
- `web/src/chat/nexconn.ts` — browser Chat SDK connection
- `specs/` — this spec and the task list
- `data/` — local store, not committed

## Code Style

```ts
export function parseName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(422, "VALIDATION_ERROR", "Enter your name.");
  }
  return value.trim().replace(/\s+/g, " ");
}
```

Validate every request body on the server. React text is escaped by default. The App Secret never reaches the browser.

## Testing Strategy

Phase 1 is verified by `npm run typecheck`, `npm run build`, the request API flow, and a browser pass of member and coordinator screens. Unit tests for status transitions are deferred until after this slice is stable.

## Boundaries

- Always: keep the App Secret on the server, check role before assign or status changes, validate input
- Ask first: adding a database, Call SDK, or a public deploy
- Never: commit `.env`, put the App Secret in the client, claim the chat works without a real Nexconn connection

## Success Criteria

- A member can request groceries, transport, or a companion visit
- A coordinator can assign a volunteer
- With Nexconn keys, assignment creates a group channel and the three roles can send messages
- Status moves Requested → Assigned → In progress → Completed, and each move after assignment is written into the room
- Without keys, the request flow still works and the screen says the room needs keys

## Open Questions

- The live URL, public GitHub repo, demo video, and write-up PDF are still needed for submission
- Phase 2 (AI, maps, verification, calls, translation, topic channels, reporting) waits until this journey is solid

## Phase 2 (not now)

AI matching, maps, identity verification, Call SDK, translation, community channels, and block/report.
