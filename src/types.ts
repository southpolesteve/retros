// Phase types
export type Phase =
  | 'waiting'
  | 'adding'
  | 'grouping'
  | 'voting'
  | 'discussion'
  | 'complete';

// Column types
export type Column = 'start' | 'stop' | 'continue';

// Data models
export interface Retro {
  id: string;
  name: string;
  createdAt: number;
  facilitatorId: string;
  phase: Phase;
}

export interface Participant {
  id: string;
  name: string;
  isFacilitator: boolean;
  isConnected: boolean;
}

export interface Item {
  id: string;
  retroId: string;
  column: Column;
  text: string;
  votes: number;
  votedByMe: boolean;
  createdAt: number;
  groupId: string | null;
}

export interface ItemGroup {
  id: string;
  retroId: string;
  column: Column;
  title: string;
  items: Item[];
  votes: number; // aggregated from all items
  createdAt: number;
}

// WebSocket attachment (persists across hibernation)
export interface WebSocketAttachment {
  visitorId: string;
  visitorName: string;
  isFacilitator: boolean;
  typingIn: Column | null; // which column they're currently typing in
  retroId: string; // needed to restore state after hibernation
}

// Typing activity state per column
export interface TypingActivity {
  start: number;
  stop: number;
  continue: number;
}

// Client -> Server messages
export type ClientMessage =
  | { type: 'join'; name: string; visitorId?: string; retroName?: string }
  | { type: 'add-item'; column: Column; text: string }
  | { type: 'vote'; itemId: string }
  | { type: 'unvote'; itemId: string }
  | { type: 'set-phase'; phase: Phase }
  | { type: 'update-retro-name'; name: string }
  | { type: 'delete-retro' }
  | { type: 'group-items'; itemIds: string[]; title?: string }
  | { type: 'ungroup'; groupId: string }
  | { type: 'update-group-title'; groupId: string; title: string }
  | { type: 'typing'; column: Column; isTyping: boolean };

// Server -> Client messages
export type ServerMessage =
  | {
      type: 'state';
      retro: Retro;
      participants: Participant[];
      items: Item[];
      groups: ItemGroup[];
      visitorId: string;
      votesRemaining: number;
    }
  | { type: 'participant-joined'; participant: Participant }
  | { type: 'participant-left'; visitorId: string }
  | { type: 'item-added'; item: Item }
  | {
      type: 'vote-updated';
      itemId: string;
      votes: number;
      votedByMe: boolean;
      votesRemaining: number;
    }
  | {
      type: 'phase-changed';
      phase: Phase;
      items?: Item[];
      groups?: ItemGroup[];
    }
  | { type: 'retro-name-updated'; name: string }
  | { type: 'retro-deleted' }
  | { type: 'items-grouped'; group: ItemGroup }
  | { type: 'items-ungrouped'; groupId: string; items: Item[] }
  | { type: 'group-title-updated'; groupId: string; title: string }
  | { type: 'typing-activity'; activity: TypingActivity }
  | { type: 'error'; message: string };

// Environment bindings
export interface Env {
  DB: D1Database;
  RETRO_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}
