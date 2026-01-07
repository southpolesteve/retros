// Phase types
export type Phase = 'waiting' | 'adding' | 'voting' | 'discussion' | 'complete';

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
}

// WebSocket attachment (persists across hibernation)
export interface WebSocketAttachment {
  visitorId: string;
  visitorName: string;
  isFacilitator: boolean;
}

// Client -> Server messages
export type ClientMessage =
  | { type: 'join'; name: string; retroName?: string }
  | { type: 'add-item'; column: Column; text: string }
  | { type: 'vote'; itemId: string }
  | { type: 'unvote'; itemId: string }
  | { type: 'set-phase'; phase: Phase }
  | { type: 'update-retro-name'; name: string }
  | { type: 'delete-retro' };

// Server -> Client messages
export type ServerMessage =
  | {
      type: 'state';
      retro: Retro;
      participants: Participant[];
      items: Item[];
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
  | { type: 'phase-changed'; phase: Phase; items?: Item[] }
  | { type: 'retro-name-updated'; name: string }
  | { type: 'retro-deleted' }
  | { type: 'error'; message: string };

// Environment bindings
export interface Env {
  DB: D1Database;
  RETRO_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}
