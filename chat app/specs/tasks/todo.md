# Saathi phase 1 tasks

- [ ] Task: Session, request store, and role checks
  - Acceptance: Member, volunteer, and coordinator can sign in. Members create one open request. Coordinators assign. Volunteer or coordinator advances status one step at a time.
  - Verify: API script and `npm run typecheck`
  - Files: `server/`, `shared/types.ts`
  - Unit Tests (deferred): status transition cases

- [ ] Task: Nexconn group room
  - Acceptance: With App Key and App Secret, assignment registers the three users, creates a group, and posts the status line. The browser connects with a server-issued token.
  - Verify: room endpoint returns a clear error when keys are missing
  - Files: `server/nexconn.ts`, `web/src/chat/nexconn.ts`
  - Unit Tests (deferred): signature header shape

- [ ] Task: Member, volunteer, and coordinator screens
  - Acceptance: Member can request help and see status. Coordinator can assign and monitor. Volunteer sees assigned work. Chat shows loading, empty, error, and messages.
  - Verify: browser pass of sign-in, request, assign, and the missing-key room state
  - Files: `web/src/`
  - Unit Tests (deferred): none in this slice
