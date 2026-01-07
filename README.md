# Retros

A real-time retrospective app for teams, built on Cloudflare Workers, Durable Objects, and D1.

## Features

- **Start/Stop/Continue format** - Classic retrospective structure
- **Real-time collaboration** - All participants see updates instantly via WebSockets
- **Anonymous submissions** - Items hidden during the Adding phase
- **Facilitator controls** - One person controls the flow through phases
- **Voting** - 3 votes per person, items sorted by votes in Discussion
- **No auth required** - Just share a link to join

## How It Works

1. Create a retro and share the link with your team
2. Everyone joins and adds items anonymously
3. Facilitator advances to Voting phase - items are revealed
4. Everyone votes (3 votes each, can stack on one item)
5. Facilitator advances to Discussion - items sorted by votes
6. Discuss and take action!

## Tech Stack

- **Cloudflare Workers** - Edge compute for API and static assets
- **Durable Objects** - WebSocket rooms with hibernation for cost efficiency
- **D1** - SQLite database for persistence
- **Vanilla JS** - No framework, fast and simple

## Quick Start

```bash
# Install dependencies
pnpm install

# Initialize local database
pnpm run db:init

# Start dev server
pnpm run dev
```

## Deploy to Cloudflare

```bash
# Login to Cloudflare
npx wrangler login

# Create D1 database (first time only)
npx wrangler d1 create retros-db
# Update database_id in wrangler.jsonc with the ID from output

# Apply schema to production
npx wrangler d1 execute retros-db --remote --file=src/db/schema.sql

# Deploy
pnpm run deploy
```

## License

MIT
