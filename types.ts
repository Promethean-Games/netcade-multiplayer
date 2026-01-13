export type PlayerPort = 1 | 2 | 3 | 4;

export interface MultiplayerPlayer {
  id: string;
  name: string;
  role: "host" | "guest";
  port: PlayerPort;
  connected: boolean;
}

export interface MultiplayerRoom {
  code: string;
  hostId: string;
  gameId?: string;
  gameName?: string;
  players: MultiplayerPlayer[];
  createdAt: number;
  state: "waiting" | "playing";
}

export interface SignalMessage {
  fromId?: string;
  toId: string;
  type: "offer" | "answer" | "ice-candidate";
  data: RTCSessionDescriptionInit | RTCIceCandidateInit | null;
}

export interface PlayerInput {
  playerId: string;
  port: PlayerPort;
  type: "button" | "joystick";
  button?: string;
  action?: "press" | "release";
  x?: number;
  y?: number;
  timestamp: number;
}

export type MultiplayerMessage =
  | { type: "create-room"; playerName?: string; gameId?: string; gameName?: string }
  | { type: "join-room"; roomCode: string; playerName?: string }
  | { type: "leave-room" }
  | { type: "room-created"; roomCode: string; room: MultiplayerRoom; player: MultiplayerPlayer }
  | { type: "room-joined"; roomCode: string; room: MultiplayerRoom; player: MultiplayerPlayer }
  | { type: "room-updated"; roomCode: string; room: MultiplayerRoom }
  | { type: "player-joined"; roomCode: string; room: MultiplayerRoom; player: MultiplayerPlayer }
  | { type: "player-left"; roomCode: string; room: MultiplayerRoom; player?: MultiplayerPlayer }
  | { type: "signal"; roomCode?: string; signal: SignalMessage }
  | { type: "game-input"; roomCode?: string; input?: PlayerInput; timestamp?: number }
  | { type: "start-game"; gameId?: string; gameName?: string; romUrl?: string }
  | { type: "game-started"; roomCode: string; room: MultiplayerRoom; gameId?: string; gameName?: string; romUrl?: string }
  | { type: "ping"; timestamp?: number }
  | { type: "pong"; timestamp?: number }
  | { type: "error"; error: string }
  // WebRTC signaling messages
  | { type: "rtc-offer"; targetId: string; sdp: RTCSessionDescriptionInit; fromId?: string }
  | { type: "rtc-answer"; targetId: string; sdp: RTCSessionDescriptionInit; fromId?: string }
  | { type: "rtc-ice"; targetId: string; candidate: RTCIceCandidateInit; fromId?: string };
