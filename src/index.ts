import type { Env } from './types';

// Re-export the Durable Object
export { RetroRoom } from './retro-room';

function generateRetroId(): string {
  // Generate a short, readable ID
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // API: Create new retro
    if (path === '/api/retros' && request.method === 'POST') {
      const retroId = generateRetroId();
      const body = (await request.json().catch(() => ({}))) as {
        name?: string;
      };
      const retroName = body.name?.trim() || 'Untitled Retro';

      // Create the retro in D1 immediately
      await env.DB.prepare(
        'INSERT INTO retros (id, name, created_at, facilitator_id, phase) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(retroId, retroName, Date.now(), '', 'waiting')
        .run();

      return Response.json({ id: retroId, name: retroName }, { status: 201 });
    }

    // API: Check if retro exists and get its info
    if (path.match(/^\/api\/retro\/[^/]+$/) && request.method === 'GET') {
      const retroId = path.split('/')[3];
      const result = await env.DB.prepare(
        'SELECT id, name FROM retros WHERE id = ?',
      )
        .bind(retroId)
        .first<{ id: string; name: string }>();

      if (result) {
        return Response.json({ exists: true, name: result.name });
      } else {
        return Response.json({ exists: false });
      }
    }

    // WebSocket: Connect to retro room
    if (path.startsWith('/api/retro/') && path.endsWith('/ws')) {
      const retroId = path.split('/')[3];

      // Validate WebSocket upgrade
      const upgradeHeader = request.headers.get('Upgrade');
      if (upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      // Get or create Durable Object for this retro
      const id = env.RETRO_ROOM.idFromName(retroId);
      const stub = env.RETRO_ROOM.get(id);

      // Forward the request to the Durable Object
      return stub.fetch(request);
    }

    // Return 404 for unmatched API routes
    if (path.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    // For retro pages, serve retro.html
    if (path.startsWith('/retro/') && !path.includes('.')) {
      return env.ASSETS.fetch(new URL('/retro.html', request.url), request);
    }

    // Home page
    if (path === '/') {
      return env.ASSETS.fetch(new URL('/index.html', request.url), request);
    }

    // Serve static assets
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
