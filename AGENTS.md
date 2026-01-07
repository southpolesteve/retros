# AGENTS.md - Development Guide for Retro App

## Project Overview

A real-time retrospective application for teams, built entirely on Cloudflare's developer platform. Teams can run Start/Stop/Continue retrospectives with anonymous submissions, voting, and facilitator-controlled phases - all through a simple shareable link.

**Live Features:**
- Create named retros with a shareable link (no auth required)
- Start/Stop/Continue retrospective format
- Anonymous item submissions (hidden during Adding phase)
- Facilitator-controlled phases: Waiting → Adding → Voting → Discussion → Complete
- Real-time collaboration via WebSockets (all participants see updates instantly)
- 3 votes per participant, items sorted by votes in Discussion
- Facilitator can rename retro, go back phases, or delete retro
- Auto-reconnect on page refresh (localStorage stores visitor name per retro)

## Tech Stack

| Technology | Purpose |
|------------|---------|
| Cloudflare Workers | HTTP routing, API endpoints, static asset serving |
| Durable Objects | Real-time WebSocket rooms with hibernation API |
| D1 (SQLite) | Persistent storage for retros, items, votes |
| TypeScript | Type-safe backend development |
| Vanilla JS/CSS | Frontend (no framework, ~600 lines total) |
| Biome | Linting and formatting |
| tsgo | Fast TypeScript type checking |
| Playwright | E2E browser testing |

## Architecture

```
Browser ──HTTP──▶ Worker ──────▶ Static Assets (public/)
   │                │
   │                ├──▶ POST /api/retros (create retro in D1)
   │                └──▶ GET /api/retro/:id (check if exists)
   │
   └──WebSocket──▶ Durable Object (RetroRoom)
                        │
                        └──▶ D1 (persist state changes)
```

**Flow:**
1. User creates retro on home page → Worker creates row in D1 with empty facilitator
2. User joins via WebSocket → Durable Object sets first joiner as facilitator
3. All state changes broadcast to connected clients in real-time
4. State persists in D1; Durable Object can hibernate between messages

## Project Structure

```
retros/
├── src/
│   ├── index.ts        # Worker entry point, HTTP routes, API
│   ├── retro-room.ts   # Durable Object (WebSocket handling, game logic)
│   ├── types.ts        # Shared TypeScript types
│   └── db/
│       └── schema.sql  # D1 database schema
├── public/
│   ├── index.html      # Home page (create retro)
│   ├── retro.html      # Retro room page
│   ├── app.js          # Client-side JavaScript
│   └── styles.css      # Light theme CSS
├── e2e/
│   ├── retro.spec.ts   # Tests for retro creation/joining
│   ├── phases.spec.ts  # Tests for phase transitions
│   └── realtime.spec.ts # Tests for real-time sync
├── .github/
│   └── workflows/
│       └── test.yml    # CI workflow (lint, typecheck, e2e tests)
├── biome.json          # Biome linting/formatting config
├── playwright.config.ts # Playwright test config
├── wrangler.jsonc      # Cloudflare configuration
├── package.json
├── tsconfig.json
└── AGENTS.md           # This file
```

## Development

### Prerequisites
- Node.js 24+ (see `.nvmrc`)
- pnpm
- Cloudflare account (for deployment)

### Local Development

```bash
# Install dependencies
pnpm install

# Initialize local D1 database
pnpm run db:init

# Start development server
pnpm run dev
```

The dev server runs on a random port (check terminal output). Open multiple browser windows to test real-time sync.

### Code Quality

```bash
# Type check with tsgo (fast native TypeScript)
pnpm run typecheck

# Lint with Biome
pnpm run lint

# Auto-fix lint issues
pnpm run lint:fix

# Format code
pnpm run format

# Run all checks (typecheck + lint)
pnpm run check
```

### Testing

```bash
# Run all e2e tests
pnpm test

# Run tests with interactive UI
pnpm run test:ui

# Run tests with visible browser
pnpm run test:headed
```

**E2E Test Coverage (14 tests):**
- Retro creation and joining (facilitator assignment)
- Phase transitions (facilitator controls)
- Real-time collaboration (multi-user sync)
- Items and voting
- Delete retro

### CI/CD

GitHub Actions runs on every push and PR:
- **Type Check & Lint** - Runs `typecheck` and `lint`
- **E2E Tests** - Runs Playwright tests with Chromium

## Deployment to Cloudflare

### First-Time Setup

1. **Login to Cloudflare:**
   ```bash
   npx wrangler login
   ```

2. **Create D1 database:**
   ```bash
   npx wrangler d1 create retros-db
   ```
   
   Copy the `database_id` from the output and update `wrangler.jsonc`:
   ```jsonc
   "d1_databases": [
     {
       "binding": "DB",
       "database_name": "retros-db",
       "database_id": "YOUR_DATABASE_ID_HERE"  // Replace this
     }
   ]
   ```

3. **Apply schema to production database:**
   ```bash
   npx wrangler d1 execute retros-db --remote --file=src/db/schema.sql
   ```

4. **Deploy:**
   ```bash
   pnpm run deploy
   ```

### Subsequent Deployments

```bash
pnpm run deploy
```

If you modify `schema.sql`, apply changes to production:
```bash
npx wrangler d1 execute retros-db --remote --file=src/db/schema.sql
```

## Coding Guidelines

### Code Style

This project uses **Biome** for linting and formatting:
- Single quotes for strings
- 2-space indentation
- Organized imports (auto-sorted)

Run `pnpm run lint:fix` to auto-fix issues.

### Durable Objects with WebSocket Hibernation

Always use the hibernation API to minimize costs:

```typescript
// GOOD - supports hibernation
this.ctx.acceptWebSocket(server);

// BAD - no hibernation support  
server.accept();
```

Implement handler methods on the DO class (not addEventListener):
- `webSocketMessage(ws, message)` - Handle incoming messages
- `webSocketClose(ws)` - Handle disconnections
- `webSocketError(ws, error)` - Handle errors

Use attachments to persist per-connection state across hibernation:
```typescript
ws.serializeAttachment({ visitorId, visitorName, isFacilitator });
const state = ws.deserializeAttachment();
```

### WebSocket Message Protocol

All messages are JSON with a `type` field:

```typescript
// Client → Server
{ type: 'join', name: 'Alice', retroName?: 'Sprint 42' }
{ type: 'add-item', column: 'start' | 'stop' | 'continue', text: string }
{ type: 'vote', itemId: string }
{ type: 'unvote', itemId: string }
{ type: 'set-phase', phase: Phase }           // facilitator only
{ type: 'update-retro-name', name: string }   // facilitator only
{ type: 'delete-retro' }                      // facilitator only

// Server → Client
{ type: 'state', retro, participants, items, visitorId, votesRemaining }
{ type: 'participant-joined', participant }
{ type: 'participant-left', visitorId }
{ type: 'item-added', item }
{ type: 'vote-updated', itemId, votes, votedByMe, votesRemaining }
{ type: 'phase-changed', phase, items }
{ type: 'retro-name-updated', name }
{ type: 'retro-deleted' }
{ type: 'error', message }
```

### Phase State Machine

```
WAITING ──(start)──▶ ADDING ──(start voting)──▶ VOTING
                         ▲                          │
                         └────(back to adding)──────┘
                                                    │
COMPLETE ◀──(complete)── DISCUSSION ◀──(end voting)─┘
    │                         │
    └─────────────────────────┘ (no going back from complete)
```

Facilitator can go forward or back one phase (except from COMPLETE).

### Voting Rules

- Each participant gets 3 votes total across all items
- Can vote multiple times on same item (all 3 on one item is valid)
- Can unvote to reallocate votes
- Items hidden during Adding phase (only show count)
- Vote counts hidden during Voting phase
- Items sorted by votes in Discussion/Complete phases

## Database Schema

```sql
CREATE TABLE retros (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled Retro',
  created_at INTEGER NOT NULL,
  facilitator_id TEXT NOT NULL,  -- empty until first person joins
  phase TEXT NOT NULL DEFAULT 'waiting'
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  retro_id TEXT NOT NULL,
  column_type TEXT NOT NULL,  -- 'start', 'stop', 'continue'
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE votes (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

## Common Issues

### WebSockets not connecting
- Check Worker forwards upgrade requests to DO correctly
- Verify DO binding name in wrangler.jsonc matches code

### State not persisting
- Ensure all D1 writes are `await`ed
- Check for SQL errors in wrangler logs

### Facilitator not being set
- First joiner should become facilitator
- Check that `facilitator_id` is empty string when retro created

### Items not showing
- Items hidden during Adding phase (by design)
- Check phase is 'voting', 'discussion', or 'complete'

### Tests failing locally
- Make sure port 8787 is free before running tests
- Run `pnpm run db:init` to reset the database
- Tests automatically start a fresh dev server

## Resources

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [D1 Database](https://developers.cloudflare.com/d1/)
- [WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/api/websockets/)
- [Biome](https://biomejs.dev/)
- [Playwright](https://playwright.dev/)
