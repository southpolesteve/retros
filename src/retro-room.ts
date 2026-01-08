import { DurableObject } from 'cloudflare:workers';
import type {
  ClientMessage,
  Column,
  Env,
  Item,
  ItemGroup,
  Participant,
  Phase,
  Retro,
  ServerMessage,
  TypingActivity,
  WebSocketAttachment,
} from './types';

const MAX_VOTES = 3;

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export class RetroRoom extends DurableObject<Env> {
  private retroId: string = '';

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

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== 'string') return;

    // Restore retroId from attachment after hibernation if needed
    if (!this.retroId) {
      const attachment =
        ws.deserializeAttachment() as WebSocketAttachment | null;
      if (attachment?.retroId) {
        this.retroId = attachment.retroId;
      }
    }

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
      // Clear typing state and broadcast updated activity
      if (attachment.typingIn) {
        attachment.typingIn = null;
        ws.serializeAttachment(attachment);
        const activity = this.getTypingActivity();
        this.broadcast({ type: 'typing-activity', activity }, ws);
      }

      this.broadcast(
        { type: 'participant-left', visitorId: attachment.visitorId },
        ws,
      );
    }
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
  }

  private async handleMessage(
    ws: WebSocket,
    data: ClientMessage,
  ): Promise<void> {
    switch (data.type) {
      case 'join':
        await this.handleJoin(ws, data.name, data.visitorId, data.retroName);
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
      case 'group-items':
        await this.handleGroupItems(ws, data.itemIds, data.title);
        break;
      case 'ungroup':
        await this.handleUngroup(ws, data.groupId);
        break;
      case 'update-group-title':
        await this.handleUpdateGroupTitle(ws, data.groupId, data.title);
        break;
      case 'typing':
        this.handleTyping(ws, data.column, data.isTyping);
        break;
    }
  }

  private async handleJoin(
    ws: WebSocket,
    name: string,
    existingVisitorId?: string,
    retroName?: string,
  ): Promise<void> {
    let retro = await this.getRetro();

    // Use existing visitorId if provided (reconnect), otherwise generate new one
    const visitorId = existingVisitorId || generateId();

    // Determine if this person should be facilitator:
    // - If reconnecting with the stored facilitator_id
    // - If retro doesn't exist (shouldn't happen with new flow, but fallback)
    // - If retro exists but has no facilitator yet (first joiner after creation)
    let isFacilitator = false;

    if (retro && retro.facilitatorId === visitorId) {
      // Reconnecting as the facilitator
      isFacilitator = true;
    } else if (!retro || !retro.facilitatorId) {
      // First person to join becomes facilitator
      isFacilitator = true;
    }

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
        'INSERT INTO retros (id, name, created_at, facilitator_id, phase) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(
          retro.id,
          retro.name,
          retro.createdAt,
          retro.facilitatorId,
          retro.phase,
        )
        .run();
    } else if (!retro.facilitatorId) {
      // Retro exists but no facilitator yet - set this person as facilitator
      retro.facilitatorId = visitorId;
      await this.env.DB.prepare(
        'UPDATE retros SET facilitator_id = ? WHERE id = ?',
      )
        .bind(visitorId, this.retroId)
        .run();
    }

    const attachment: WebSocketAttachment = {
      visitorId,
      visitorName: name,
      isFacilitator,
      typingIn: null,
      retroId: this.retroId,
    };
    ws.serializeAttachment(attachment);

    // At this point, retro is guaranteed to be defined
    const currentRetro = retro as Retro;

    const participants = this.getParticipants();
    const items = await this.getItems(visitorId, currentRetro.phase);
    const groups = await this.getGroups(visitorId, currentRetro.phase);
    const votesRemaining = await this.getVotesRemaining(visitorId);

    this.sendTo(ws, {
      type: 'state',
      retro: currentRetro,
      participants,
      items,
      groups,
      visitorId,
      votesRemaining,
    });

    this.broadcast(
      {
        type: 'participant-joined',
        participant: {
          id: visitorId,
          name,
          isFacilitator,
          isConnected: true,
        },
      },
      ws,
    );
  }

  private async handleAddItem(
    ws: WebSocket,
    column: Column,
    text: string,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment) {
      this.sendTo(ws, { type: 'error', message: 'Not joined' });
      return;
    }

    const retro = await this.getRetro();
    if (!retro || retro.phase !== 'adding') {
      this.sendTo(ws, {
        type: 'error',
        message: 'Cannot add items in current phase',
      });
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
      groupId: null,
    };

    await this.env.DB.prepare(
      'INSERT INTO items (id, retro_id, column_type, text, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(item.id, item.retroId, item.column, item.text, item.createdAt)
      .run();

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
      this.sendTo(ws, {
        type: 'error',
        message: 'Cannot vote in current phase',
      });
      return;
    }

    const votesUsed = await this.getVotesUsed(attachment.visitorId);
    if (votesUsed >= MAX_VOTES) {
      this.sendTo(ws, { type: 'error', message: 'No votes remaining' });
      return;
    }

    const voteId = generateId();
    await this.env.DB.prepare(
      'INSERT INTO votes (id, item_id, participant_id, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(voteId, itemId, attachment.visitorId, Date.now())
      .run();

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
      this.sendTo(ws, {
        type: 'error',
        message: 'Cannot unvote in current phase',
      });
      return;
    }

    await this.env.DB.prepare(
      `DELETE FROM votes WHERE id IN (
        SELECT id FROM votes WHERE item_id = ? AND participant_id = ? LIMIT 1
      )`,
    )
      .bind(itemId, attachment.visitorId)
      .run();

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
      this.sendTo(ws, {
        type: 'error',
        message: 'Only facilitator can change phase',
      });
      return;
    }

    const retro = await this.getRetro();
    if (!retro) {
      this.sendTo(ws, { type: 'error', message: 'Retro not found' });
      return;
    }

    const phaseOrder: Phase[] = [
      'waiting',
      'adding',
      'grouping',
      'voting',
      'discussion',
      'complete',
    ];
    const currentIndex = phaseOrder.indexOf(retro.phase);
    const targetIndex = phaseOrder.indexOf(phase);

    if (retro.phase === 'complete' || currentIndex === targetIndex) {
      this.sendTo(ws, { type: 'error', message: 'Invalid phase transition' });
      return;
    }

    await this.env.DB.prepare('UPDATE retros SET phase = ? WHERE id = ?')
      .bind(phase, this.retroId)
      .run();

    // Clear all typing states when phase changes away from adding
    if (phase !== 'adding') {
      this.clearAllTypingStates();
    }

    if (
      phase === 'grouping' ||
      phase === 'voting' ||
      phase === 'discussion' ||
      phase === 'complete'
    ) {
      const items = await this.getItemsWithVotes();
      const groups = await this.getGroupsWithVotes();
      this.broadcast({ type: 'phase-changed', phase, items, groups });
    } else {
      this.broadcast({ type: 'phase-changed', phase, items: [], groups: [] });
    }
  }

  private clearAllTypingStates(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment =
        socket.deserializeAttachment() as WebSocketAttachment | null;
      if (attachment?.typingIn) {
        attachment.typingIn = null;
        socket.serializeAttachment(attachment);
      }
    }
  }

  private async handleUpdateRetroName(
    ws: WebSocket,
    name: string,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment || !attachment.isFacilitator) {
      this.sendTo(ws, {
        type: 'error',
        message: 'Only facilitator can rename retro',
      });
      return;
    }

    const trimmedName = name.trim() || 'Untitled Retro';
    await this.env.DB.prepare('UPDATE retros SET name = ? WHERE id = ?')
      .bind(trimmedName, this.retroId)
      .run();

    this.broadcast({ type: 'retro-name-updated', name: trimmedName });
  }

  private async handleDeleteRetro(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment || !attachment.isFacilitator) {
      this.sendTo(ws, {
        type: 'error',
        message: 'Only facilitator can delete retro',
      });
      return;
    }

    await this.env.DB.prepare(
      'DELETE FROM votes WHERE item_id IN (SELECT id FROM items WHERE retro_id = ?)',
    )
      .bind(this.retroId)
      .run();
    await this.env.DB.prepare('DELETE FROM items WHERE retro_id = ?')
      .bind(this.retroId)
      .run();
    await this.env.DB.prepare('DELETE FROM item_groups WHERE retro_id = ?')
      .bind(this.retroId)
      .run();
    await this.env.DB.prepare('DELETE FROM retros WHERE id = ?')
      .bind(this.retroId)
      .run();

    this.broadcast({ type: 'retro-deleted' });

    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1000, 'Retro deleted');
    }
  }

  private async handleGroupItems(
    ws: WebSocket,
    itemIds: string[],
    title?: string,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment || !attachment.isFacilitator) {
      this.sendTo(ws, {
        type: 'error',
        message: 'Only facilitator can group items',
      });
      return;
    }

    const retro = await this.getRetro();
    if (!retro || retro.phase !== 'grouping') {
      this.sendTo(ws, {
        type: 'error',
        message: 'Can only group items in Grouping phase',
      });
      return;
    }

    if (itemIds.length < 2) {
      this.sendTo(ws, {
        type: 'error',
        message: 'Need at least 2 items to group',
      });
      return;
    }

    // Get the first item to determine column type
    const firstItem = await this.env.DB.prepare(
      'SELECT column_type, group_id FROM items WHERE id = ? AND retro_id = ?',
    )
      .bind(itemIds[0], this.retroId)
      .first<{ column_type: Column; group_id: string | null }>();

    if (!firstItem) {
      this.sendTo(ws, { type: 'error', message: 'Item not found' });
      return;
    }

    // Check if we're adding to an existing group (when title is provided and first item has a group)
    // In that case, reuse the existing group
    let groupId: string;
    let groupTitle: string;

    if (firstItem.group_id && title) {
      // Adding to existing group - reuse its ID
      groupId = firstItem.group_id;
      groupTitle = title;
    } else {
      // Creating a new group
      groupId = generateId();
      groupTitle = title || 'Grouped Items';
      const createdAt = Date.now();

      // Delete any empty groups that items may have belonged to
      const oldGroupIds = new Set<string>();
      for (const itemId of itemIds) {
        const item = await this.env.DB.prepare(
          'SELECT group_id FROM items WHERE id = ?',
        )
          .bind(itemId)
          .first<{ group_id: string | null }>();
        if (item?.group_id) {
          oldGroupIds.add(item.group_id);
        }
      }

      await this.env.DB.prepare(
        'INSERT INTO item_groups (id, retro_id, column_type, title, created_at) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(
          groupId,
          this.retroId,
          firstItem.column_type,
          groupTitle,
          createdAt,
        )
        .run();

      // Clean up old groups that will be empty after this operation
      for (const oldGroupId of oldGroupIds) {
        // Count remaining items in the old group (excluding items we're moving)
        const remaining = await this.env.DB.prepare(
          `SELECT COUNT(*) as count FROM items WHERE group_id = ? AND id NOT IN (${itemIds.map(() => '?').join(',')})`,
        )
          .bind(oldGroupId, ...itemIds)
          .first<{ count: number }>();
        if (remaining && remaining.count === 0) {
          await this.env.DB.prepare('DELETE FROM item_groups WHERE id = ?')
            .bind(oldGroupId)
            .run();
        }
      }
    }

    // Update items to belong to this group
    for (const itemId of itemIds) {
      await this.env.DB.prepare(
        'UPDATE items SET group_id = ? WHERE id = ? AND retro_id = ?',
      )
        .bind(groupId, itemId, this.retroId)
        .run();
    }

    // Get the full group with items
    const group = await this.getGroupById(groupId);
    if (group) {
      this.broadcast({ type: 'items-grouped', group });
    }
  }

  private async handleUngroup(ws: WebSocket, groupId: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment || !attachment.isFacilitator) {
      this.sendTo(ws, {
        type: 'error',
        message: 'Only facilitator can ungroup items',
      });
      return;
    }

    const retro = await this.getRetro();
    if (!retro || retro.phase !== 'grouping') {
      this.sendTo(ws, {
        type: 'error',
        message: 'Can only ungroup items in Grouping phase',
      });
      return;
    }

    // Get items that will be ungrouped
    const items = await this.getItemsByGroupId(groupId);

    // Remove group_id from items
    await this.env.DB.prepare(
      'UPDATE items SET group_id = NULL WHERE group_id = ?',
    )
      .bind(groupId)
      .run();

    // Delete the group
    await this.env.DB.prepare('DELETE FROM item_groups WHERE id = ?')
      .bind(groupId)
      .run();

    this.broadcast({ type: 'items-ungrouped', groupId, items });
  }

  private async handleUpdateGroupTitle(
    ws: WebSocket,
    groupId: string,
    title: string,
  ): Promise<void> {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment || !attachment.isFacilitator) {
      this.sendTo(ws, {
        type: 'error',
        message: 'Only facilitator can rename groups',
      });
      return;
    }

    const trimmedTitle = title.trim() || 'Grouped Items';
    await this.env.DB.prepare(
      'UPDATE item_groups SET title = ? WHERE id = ? AND retro_id = ?',
    )
      .bind(trimmedTitle, groupId, this.retroId)
      .run();

    this.broadcast({
      type: 'group-title-updated',
      groupId,
      title: trimmedTitle,
    });
  }

  private handleTyping(ws: WebSocket, column: Column, isTyping: boolean): void {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null;
    if (!attachment) return;

    // Update the attachment with typing state
    const newTypingIn = isTyping ? column : null;
    if (attachment.typingIn === newTypingIn) return; // No change

    attachment.typingIn = newTypingIn;
    ws.serializeAttachment(attachment);

    // Broadcast updated typing activity to all clients
    const activity = this.getTypingActivity();
    this.broadcast({ type: 'typing-activity', activity });
  }

  private getTypingActivity(): TypingActivity {
    const activity: TypingActivity = { start: 0, stop: 0, continue: 0 };

    for (const socket of this.ctx.getWebSockets()) {
      const attachment =
        socket.deserializeAttachment() as WebSocketAttachment | null;
      if (attachment?.typingIn) {
        activity[attachment.typingIn]++;
      }
    }

    return activity;
  }

  private async getRetro(): Promise<Retro | null> {
    const result = await this.env.DB.prepare(
      'SELECT id, name, created_at, facilitator_id, phase FROM retros WHERE id = ?',
    )
      .bind(this.retroId)
      .first<{
        id: string;
        name: string;
        created_at: number;
        facilitator_id: string;
        phase: Phase;
      }>();

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
      const attachment =
        socket.deserializeAttachment() as WebSocketAttachment | null;
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
      'SELECT id, retro_id, column_type, text, created_at, group_id FROM items WHERE retro_id = ? ORDER BY created_at ASC',
    )
      .bind(this.retroId)
      .all<{
        id: string;
        retro_id: string;
        column_type: Column;
        text: string;
        created_at: number;
        group_id: string | null;
      }>();

    const items: Item[] = [];
    for (const row of results.results || []) {
      const voteCount =
        phase === 'voting' ? 0 : await this.getVoteCount(row.id);
      const myVoteCount = await this.getMyVoteCount(row.id, visitorId);

      items.push({
        id: row.id,
        retroId: row.retro_id,
        column: row.column_type,
        text: row.text,
        votes: voteCount,
        votedByMe: myVoteCount > 0,
        createdAt: row.created_at,
        groupId: row.group_id,
      });
    }

    return items;
  }

  private async getItemsWithVotes(): Promise<Item[]> {
    const results = await this.env.DB.prepare(
      'SELECT id, retro_id, column_type, text, created_at, group_id FROM items WHERE retro_id = ? ORDER BY created_at ASC',
    )
      .bind(this.retroId)
      .all<{
        id: string;
        retro_id: string;
        column_type: Column;
        text: string;
        created_at: number;
        group_id: string | null;
      }>();

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
        groupId: row.group_id,
      });
    }

    items.sort((a, b) => b.votes - a.votes);
    return items;
  }

  private async getVoteCount(itemId: string): Promise<number> {
    const result = await this.env.DB.prepare(
      'SELECT COUNT(*) as count FROM votes WHERE item_id = ?',
    )
      .bind(itemId)
      .first<{ count: number }>();
    return result?.count || 0;
  }

  private async getMyVoteCount(
    itemId: string,
    visitorId: string,
  ): Promise<number> {
    const result = await this.env.DB.prepare(
      'SELECT COUNT(*) as count FROM votes WHERE item_id = ? AND participant_id = ?',
    )
      .bind(itemId, visitorId)
      .first<{ count: number }>();
    return result?.count || 0;
  }

  private async getVotesUsed(visitorId: string): Promise<number> {
    const result = await this.env.DB.prepare(
      `SELECT COUNT(*) as count FROM votes v
       JOIN items i ON v.item_id = i.id
       WHERE v.participant_id = ? AND i.retro_id = ?`,
    )
      .bind(visitorId, this.retroId)
      .first<{ count: number }>();
    return result?.count || 0;
  }

  private async getVotesRemaining(visitorId: string): Promise<number> {
    const used = await this.getVotesUsed(visitorId);
    return MAX_VOTES - used;
  }

  private async getGroups(
    visitorId: string,
    phase: Phase,
  ): Promise<ItemGroup[]> {
    const results = await this.env.DB.prepare(
      'SELECT id, retro_id, column_type, title, created_at FROM item_groups WHERE retro_id = ? ORDER BY created_at ASC',
    )
      .bind(this.retroId)
      .all<{
        id: string;
        retro_id: string;
        column_type: Column;
        title: string;
        created_at: number;
      }>();

    const groups: ItemGroup[] = [];
    for (const row of results.results || []) {
      const items = await this.getItemsByGroupId(row.id, visitorId, phase);
      const votes = items.reduce((sum, item) => sum + item.votes, 0);

      groups.push({
        id: row.id,
        retroId: row.retro_id,
        column: row.column_type,
        title: row.title,
        items,
        votes,
        createdAt: row.created_at,
      });
    }

    return groups;
  }

  private async getGroupsWithVotes(): Promise<ItemGroup[]> {
    const results = await this.env.DB.prepare(
      'SELECT id, retro_id, column_type, title, created_at FROM item_groups WHERE retro_id = ? ORDER BY created_at ASC',
    )
      .bind(this.retroId)
      .all<{
        id: string;
        retro_id: string;
        column_type: Column;
        title: string;
        created_at: number;
      }>();

    const groups: ItemGroup[] = [];
    for (const row of results.results || []) {
      const items = await this.getItemsByGroupIdWithVotes(row.id);
      const votes = items.reduce((sum, item) => sum + item.votes, 0);

      groups.push({
        id: row.id,
        retroId: row.retro_id,
        column: row.column_type,
        title: row.title,
        items,
        votes,
        createdAt: row.created_at,
      });
    }

    groups.sort((a, b) => b.votes - a.votes);
    return groups;
  }

  private async getGroupById(groupId: string): Promise<ItemGroup | null> {
    const row = await this.env.DB.prepare(
      'SELECT id, retro_id, column_type, title, created_at FROM item_groups WHERE id = ?',
    )
      .bind(groupId)
      .first<{
        id: string;
        retro_id: string;
        column_type: Column;
        title: string;
        created_at: number;
      }>();

    if (!row) return null;

    const items = await this.getItemsByGroupIdWithVotes(groupId);
    const votes = items.reduce((sum, item) => sum + item.votes, 0);

    return {
      id: row.id,
      retroId: row.retro_id,
      column: row.column_type,
      title: row.title,
      items,
      votes,
      createdAt: row.created_at,
    };
  }

  private async getItemsByGroupId(
    groupId: string,
    visitorId?: string,
    phase?: Phase,
  ): Promise<Item[]> {
    const results = await this.env.DB.prepare(
      'SELECT id, retro_id, column_type, text, created_at, group_id FROM items WHERE group_id = ? ORDER BY created_at ASC',
    )
      .bind(groupId)
      .all<{
        id: string;
        retro_id: string;
        column_type: Column;
        text: string;
        created_at: number;
        group_id: string | null;
      }>();

    const items: Item[] = [];
    for (const row of results.results || []) {
      const voteCount =
        phase === 'voting' ? 0 : await this.getVoteCount(row.id);
      const myVoteCount = visitorId
        ? await this.getMyVoteCount(row.id, visitorId)
        : 0;

      items.push({
        id: row.id,
        retroId: row.retro_id,
        column: row.column_type,
        text: row.text,
        votes: voteCount,
        votedByMe: myVoteCount > 0,
        createdAt: row.created_at,
        groupId: row.group_id,
      });
    }

    return items;
  }

  private async getItemsByGroupIdWithVotes(groupId: string): Promise<Item[]> {
    const results = await this.env.DB.prepare(
      'SELECT id, retro_id, column_type, text, created_at, group_id FROM items WHERE group_id = ? ORDER BY created_at ASC',
    )
      .bind(groupId)
      .all<{
        id: string;
        retro_id: string;
        column_type: Column;
        text: string;
        created_at: number;
        group_id: string | null;
      }>();

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
        groupId: row.group_id,
      });
    }

    return items;
  }

  private sendTo(ws: WebSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      if (
        socket !== exclude &&
        socket.readyState === WebSocket.READY_STATE_OPEN
      ) {
        socket.send(data);
      }
    }
  }
}
