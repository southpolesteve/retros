import { DurableObject } from 'cloudflare:workers';
import type {
  Env,
  Phase,
  Column,
  Retro,
  Participant,
  Item,
  ClientMessage,
  ServerMessage,
  WebSocketAttachment,
} from './types';

const MAX_VOTES = 3;

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export class RetroRoom extends DurableObject<Env> {
  private retroId: string = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // URL is /api/retro/{retroId}/ws, so split and get index 3
    const pathParts = url.pathname.split('/');
    this.retroId = pathParts[3] || '';

    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Expected WebSocket', { status: 400 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;

    try {
      const data: ClientMessage = JSON.parse(message);
      await this.handleMessage(ws, data);
    } catch (error) {
      console.error('Error handling message:', error);
      this.sendTo(ws, { type: 'error', message: 'Invalid message format' });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (attachment) {
      this.broadcast({ type: 'participant-left', visitorId: attachment.visitorId }, ws);
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
  }

  private async handleMessage(ws: WebSocket, data: ClientMessage): Promise<void> {
    switch (data.type) {
      case 'join':
        await this.handleJoin(ws, data.name, data.retroName);
        break;
      case 'add-item':
        await this.handleAddItem(ws, data.column, data.text);
        break;
      case 'vote':
        await this.handleVote(ws, data.itemId);
        break;
      case 'unvote':
        await this.handleUnvote(ws, data.itemId);
        break;
      case 'set-phase':
        await this.handleSetPhase(ws, data.phase);
        break;
      case 'update-retro-name':
        await this.handleUpdateRetroName(ws, data.name);
        break;
      case 'delete-retro':
        await this.handleDeleteRetro(ws);
        break;
    }
  }

  private async handleJoin(ws: WebSocket, name: string, retroName?: string): Promise<void> {
    let retro = await this.getRetro();
    const visitorId = generateId();
    
    // Determine if this person should be facilitator:
    // - If retro doesn't exist (shouldn't happen with new flow, but fallback)
    // - If retro exists but has no facilitator yet (first joiner after creation)
    const needsFacilitator = !retro || !retro.facilitatorId;
    const isFacilitator = needsFacilitator;
    


    if (!retro) {
      // Fallback: create retro if it doesn't exist (old flow or direct URL access)
      retro = {
        id: this.retroId,
        name: retroName || 'Untitled Retro',
        createdAt: Date.now(),
        facilitatorId: visitorId,
        phase: 'waiting',
      };
      await this.env.DB.prepare(
        'INSERT INTO retros (id, name, created_at, facilitator_id, phase) VALUES (?, ?, ?, ?, ?)'
      ).bind(retro.id, retro.name, retro.createdAt, retro.facilitatorId, retro.phase).run();
    } else if (!retro.facilitatorId) {
      // Retro exists but no facilitator yet - set this person as facilitator
      retro.facilitatorId = visitorId;
      await this.env.DB.prepare(
        'UPDATE retros SET facilitator_id = ? WHERE id = ?'
      ).bind(visitorId, this.retroId).run();
    }

    const attachment: WebSocketAttachment = {
      visitorId,
      visitorName: name,
      isFacilitator,
    };
    ws.serializeAttachment(attachment);

    const participants = this.getParticipants();
    const items = await this.getItems(visitorId, retro!.phase);
    const votesRemaining = await this.getVotesRemaining(visitorId);

    this.sendTo(ws, {
      type: 'state',
      retro: retro!,
      participants,
      items,
      visitorId,
      votesRemaining,
    });

    this.broadcast({
      type: 'participant-joined',
      participant: {
        id: visitorId,
        name,
        isFacilitator,
        isConnected: true,
      },
    }, ws);
  }

  private async handleAddItem(ws: WebSocket, column: Column, text: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment) {
      this.sendTo(ws, { type: 'error', message: 'Not joined' });
      return;
    }

    const retro = await this.getRetro();
    if (!retro || retro.phase !== 'adding') {
      this.sendTo(ws, { type: 'error', message: 'Cannot add items in current phase' });
      return;
    }

    const item: Item = {
      id: generateId(),
      retroId: this.retroId,
      column,
      text: text.trim(),
      votes: 0,
      votedByMe: false,
      createdAt: Date.now(),
    };

    await this.env.DB.prepare(
      'INSERT INTO items (id, retro_id, column_type, text, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(item.id, item.retroId, item.column, item.text, item.createdAt).run();

    this.broadcast({ type: 'item-added', item });
  }

  private async handleVote(ws: WebSocket, itemId: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment) {
      this.sendTo(ws, { type: 'error', message: 'Not joined' });
      return;
    }

    const retro = await this.getRetro();
    if (!retro || retro.phase !== 'voting') {
      this.sendTo(ws, { type: 'error', message: 'Cannot vote in current phase' });
      return;
    }

    const votesUsed = await this.getVotesUsed(attachment.visitorId);
    if (votesUsed >= MAX_VOTES) {
      this.sendTo(ws, { type: 'error', message: 'No votes remaining' });
      return;
    }

    const voteId = generateId();
    await this.env.DB.prepare(
      'INSERT INTO votes (id, item_id, participant_id, created_at) VALUES (?, ?, ?, ?)'
    ).bind(voteId, itemId, attachment.visitorId, Date.now()).run();

    const voteCount = await this.getVoteCount(itemId);
    const votesRemaining = MAX_VOTES - votesUsed - 1;

    this.sendTo(ws, {
      type: 'vote-updated',
      itemId,
      votes: voteCount,
      votedByMe: true,
      votesRemaining,
    });
  }

  private async handleUnvote(ws: WebSocket, itemId: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment) {
      this.sendTo(ws, { type: 'error', message: 'Not joined' });
      return;
    }

    const retro = await this.getRetro();
    if (!retro || retro.phase !== 'voting') {
      this.sendTo(ws, { type: 'error', message: 'Cannot unvote in current phase' });
      return;
    }

    await this.env.DB.prepare(
      `DELETE FROM votes WHERE id IN (
        SELECT id FROM votes WHERE item_id = ? AND participant_id = ? LIMIT 1
      )`
    ).bind(itemId, attachment.visitorId).run();

    const voteCount = await this.getVoteCount(itemId);
    const myVoteCount = await this.getMyVoteCount(itemId, attachment.visitorId);
    const votesUsed = await this.getVotesUsed(attachment.visitorId);

    this.sendTo(ws, {
      type: 'vote-updated',
      itemId,
      votes: voteCount,
      votedByMe: myVoteCount > 0,
      votesRemaining: MAX_VOTES - votesUsed,
    });
  }

  private async handleSetPhase(ws: WebSocket, phase: Phase): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment || !attachment.isFacilitator) {
      this.sendTo(ws, { type: 'error', message: 'Only facilitator can change phase' });
      return;
    }

    const retro = await this.getRetro();
    if (!retro) {
      this.sendTo(ws, { type: 'error', message: 'Retro not found' });
      return;
    }

    const phaseOrder: Phase[] = ['waiting', 'adding', 'voting', 'discussion', 'complete'];
    const currentIndex = phaseOrder.indexOf(retro.phase);
    const targetIndex = phaseOrder.indexOf(phase);

    if (retro.phase === 'complete' || currentIndex === targetIndex) {
      this.sendTo(ws, { type: 'error', message: 'Invalid phase transition' });
      return;
    }

    await this.env.DB.prepare(
      'UPDATE retros SET phase = ? WHERE id = ?'
    ).bind(phase, this.retroId).run();

    if (phase === 'voting' || phase === 'discussion' || phase === 'complete') {
      const items = await this.getItemsWithVotes();
      this.broadcast({ type: 'phase-changed', phase, items });
    } else {
      this.broadcast({ type: 'phase-changed', phase, items: [] });
    }
  }

  private async handleUpdateRetroName(ws: WebSocket, name: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment || !attachment.isFacilitator) {
      this.sendTo(ws, { type: 'error', message: 'Only facilitator can rename retro' });
      return;
    }

    const trimmedName = name.trim() || 'Untitled Retro';
    await this.env.DB.prepare(
      'UPDATE retros SET name = ? WHERE id = ?'
    ).bind(trimmedName, this.retroId).run();

    this.broadcast({ type: 'retro-name-updated', name: trimmedName });
  }

  private async handleDeleteRetro(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment || !attachment.isFacilitator) {
      this.sendTo(ws, { type: 'error', message: 'Only facilitator can delete retro' });
      return;
    }

    await this.env.DB.prepare('DELETE FROM votes WHERE item_id IN (SELECT id FROM items WHERE retro_id = ?)').bind(this.retroId).run();
    await this.env.DB.prepare('DELETE FROM items WHERE retro_id = ?').bind(this.retroId).run();
    await this.env.DB.prepare('DELETE FROM retros WHERE id = ?').bind(this.retroId).run();

    this.broadcast({ type: 'retro-deleted' });

    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1000, 'Retro deleted');
    }
  }

  private async getRetro(): Promise<Retro | null> {
    const result = await this.env.DB.prepare(
      'SELECT id, name, created_at, facilitator_id, phase FROM retros WHERE id = ?'
    ).bind(this.retroId).first<{ id: string; name: string; created_at: number; facilitator_id: string; phase: Phase }>();

    if (!result) return null;

    return {
      id: result.id,
      name: result.name,
      createdAt: result.created_at,
      facilitatorId: result.facilitator_id,
      phase: result.phase,
    };
  }

  private getParticipants(): Participant[] {
    const participants: Participant[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as WebSocketAttachment | null;
      if (attachment) {
        participants.push({
          id: attachment.visitorId,
          name: attachment.visitorName,
          isFacilitator: attachment.isFacilitator,
          isConnected: true,
        });
      }
    }
    return participants;
  }

  private async getItems(visitorId: string, phase: Phase): Promise<Item[]> {
    const results = await this.env.DB.prepare(
      'SELECT id, retro_id, column_type, text, created_at FROM items WHERE retro_id = ? ORDER BY created_at ASC'
    ).bind(this.retroId).all<{ id: string; retro_id: string; column_type: Column; text: string; created_at: number }>();

    const items: Item[] = [];
    for (const row of results.results || []) {
      const voteCount = phase === 'voting' ? 0 : await this.getVoteCount(row.id);
      const myVoteCount = await this.getMyVoteCount(row.id, visitorId);

      items.push({
        id: row.id,
        retroId: row.retro_id,
        column: row.column_type,
        text: row.text,
        votes: voteCount,
        votedByMe: myVoteCount > 0,
        createdAt: row.created_at,
      });
    }

    return items;
  }

  private async getItemsWithVotes(): Promise<Item[]> {
    const results = await this.env.DB.prepare(
      'SELECT id, retro_id, column_type, text, created_at FROM items WHERE retro_id = ? ORDER BY created_at ASC'
    ).bind(this.retroId).all<{ id: string; retro_id: string; column_type: Column; text: string; created_at: number }>();

    const items: Item[] = [];
    for (const row of results.results || []) {
      const voteCount = await this.getVoteCount(row.id);

      items.push({
        id: row.id,
        retroId: row.retro_id,
        column: row.column_type,
        text: row.text,
        votes: voteCount,
        votedByMe: false,
        createdAt: row.created_at,
      });
    }

    items.sort((a, b) => b.votes - a.votes);
    return items;
  }

  private async getVoteCount(itemId: string): Promise<number> {
    const result = await this.env.DB.prepare(
      'SELECT COUNT(*) as count FROM votes WHERE item_id = ?'
    ).bind(itemId).first<{ count: number }>();
    return result?.count || 0;
  }

  private async getMyVoteCount(itemId: string, visitorId: string): Promise<number> {
    const result = await this.env.DB.prepare(
      'SELECT COUNT(*) as count FROM votes WHERE item_id = ? AND participant_id = ?'
    ).bind(itemId, visitorId).first<{ count: number }>();
    return result?.count || 0;
  }

  private async getVotesUsed(visitorId: string): Promise<number> {
    const result = await this.env.DB.prepare(
      `SELECT COUNT(*) as count FROM votes v
       JOIN items i ON v.item_id = i.id
       WHERE v.participant_id = ? AND i.retro_id = ?`
    ).bind(visitorId, this.retroId).first<{ count: number }>();
    return result?.count || 0;
  }

  private async getVotesRemaining(visitorId: string): Promise<number> {
    const used = await this.getVotesUsed(visitorId);
    return MAX_VOTES - used;
  }

  private sendTo(ws: WebSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== exclude && socket.readyState === WebSocket.READY_STATE_OPEN) {
        socket.send(data);
      }
    }
  }
}
