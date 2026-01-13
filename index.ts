import { WebSocketServer, WebSocket } from "ws";
import { createServer, IncomingMessage, ServerResponse } from "http";
import type {
  MultiplayerMessage,
  MultiplayerRoom,
  MultiplayerPlayer,
  PlayerPort,
  SignalMessage,
} from "./types.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || ["*"];
const ROOM_TIMEOUT_MS = 3600000; // 1 hour

const rooms = new Map<string, MultiplayerRoom>();
const clients = new Map<WebSocket, { playerId: string; roomCode: string | null }>();
const playerSockets = new Map<string, WebSocket>();

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function generatePlayerId(): string {
  return `player-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getAvailablePort(room: MultiplayerRoom): PlayerPort | null {
  const usedPorts = new Set(room.players.map((p) => p.port));
  for (let port = 1; port <= 4; port++) {
    if (!usedPorts.has(port as PlayerPort)) {
      return port as PlayerPort;
    }
  }
  return null;
}

function broadcastToRoom(roomCode: string, message: MultiplayerMessage, excludePlayerId?: string) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.players.forEach((player) => {
    if (player.id !== excludePlayerId) {
      const socket = playerSockets.get(player.id);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    }
  });
}

function sendToPlayer(playerId: string, message: MultiplayerMessage) {
  const socket = playerSockets.get(playerId);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendError(ws: WebSocket, error: string) {
  const message: MultiplayerMessage = { type: "error", error };
  ws.send(JSON.stringify(message));
}

function handleCreateRoom(ws: WebSocket, playerName: string, gameId?: string, gameName?: string) {
  const clientData = clients.get(ws);
  if (!clientData) return;

  if (clientData.roomCode) {
    sendError(ws, "Already in a room");
    return;
  }

  const roomCode = generateRoomCode();
  const player: MultiplayerPlayer = {
    id: clientData.playerId,
    name: playerName || "Host",
    role: "host",
    port: 1,
    connected: true,
  };

  const room: MultiplayerRoom = {
    code: roomCode,
    hostId: clientData.playerId,
    gameId,
    gameName,
    players: [player],
    createdAt: Date.now(),
    state: "waiting",
  };

  rooms.set(roomCode, room);
  clientData.roomCode = roomCode;

  const response: MultiplayerMessage = {
    type: "room-created",
    roomCode,
    room,
    player,
  };
  ws.send(JSON.stringify(response));

  log(`Room ${roomCode} created by ${playerName}`);
}

function handleJoinRoom(ws: WebSocket, roomCode: string, playerName: string) {
  const clientData = clients.get(ws);
  if (!clientData) return;

  if (clientData.roomCode) {
    sendError(ws, "Already in a room");
    return;
  }

  const room = rooms.get(roomCode.toUpperCase());
  if (!room) {
    sendError(ws, "Room not found");
    return;
  }

  if (room.players.length >= 4) {
    sendError(ws, "Room is full");
    return;
  }

  const port = getAvailablePort(room);
  if (!port) {
    sendError(ws, "No available controller ports");
    return;
  }

  const player: MultiplayerPlayer = {
    id: clientData.playerId,
    name: playerName || `Player ${port}`,
    role: "guest",
    port,
    connected: true,
  };

  room.players.push(player);
  clientData.roomCode = roomCode.toUpperCase();

  const joinedResponse: MultiplayerMessage = {
    type: "room-joined",
    roomCode: room.code,
    room,
    player,
  };
  ws.send(JSON.stringify(joinedResponse));

  const playerJoinedMsg: MultiplayerMessage = {
    type: "player-joined",
    roomCode: room.code,
    room,
    player,
  };
  broadcastToRoom(room.code, playerJoinedMsg, clientData.playerId);

  log(`${playerName} joined room ${roomCode} as P${port}`);
}

function handleLeaveRoom(ws: WebSocket) {
  const clientData = clients.get(ws);
  if (!clientData || !clientData.roomCode) return;

  const roomCode = clientData.roomCode;
  const room = rooms.get(roomCode);
  if (!room) {
    clientData.roomCode = null;
    return;
  }

  const leavingPlayer = room.players.find((p) => p.id === clientData.playerId);
  const wasHost = room.hostId === clientData.playerId;
  room.players = room.players.filter((p) => p.id !== clientData.playerId);

  if (room.players.length === 0) {
    rooms.delete(roomCode);
    log(`Room ${roomCode} closed (empty)`);
  } else if (wasHost) {
    const newHost = room.players[0];
    room.hostId = newHost.id;
    newHost.role = "host";
    
    let portCounter = 1;
    room.players.forEach((p) => {
      p.port = portCounter as 1 | 2 | 3 | 4;
      portCounter++;
    });

    const hostChangedMsg: MultiplayerMessage = {
      type: "room-updated",
      roomCode: room.code,
      room,
    };
    broadcastToRoom(room.code, hostChangedMsg);
    
    const playerLeftMsg: MultiplayerMessage = {
      type: "player-left",
      roomCode: room.code,
      room,
      player: leavingPlayer,
    };
    broadcastToRoom(room.code, playerLeftMsg);
    
    log(`Host left room ${roomCode}, transferred to ${newHost.name}`);
  } else {
    const playerLeftMsg: MultiplayerMessage = {
      type: "player-left",
      roomCode: room.code,
      room,
      player: leavingPlayer,
    };
    broadcastToRoom(room.code, playerLeftMsg);
  }

  clientData.roomCode = null;
  log(`Player ${leavingPlayer?.name || "unknown"} left room ${roomCode}`);
}

function handleSignal(ws: WebSocket, signal: SignalMessage) {
  const clientData = clients.get(ws);
  if (!clientData || !clientData.roomCode) {
    sendError(ws, "Not in a room");
    return;
  }

  const room = rooms.get(clientData.roomCode);
  if (!room) {
    sendError(ws, "Room not found");
    return;
  }

  const targetPlayer = room.players.find((p) => p.id === signal.toId);
  if (!targetPlayer) {
    sendError(ws, "Target player not found");
    return;
  }

  const signalMsg: MultiplayerMessage = {
    type: "signal",
    roomCode: room.code,
    signal: {
      ...signal,
      fromId: clientData.playerId,
    },
  };
  sendToPlayer(signal.toId, signalMsg);
}

function handleGameInput(ws: WebSocket, message: MultiplayerMessage & { input?: any }) {
  const clientData = clients.get(ws);
  if (!clientData || !clientData.roomCode) return;

  const room = rooms.get(clientData.roomCode);
  if (!room) return;

  const inputMsg: MultiplayerMessage = {
    type: "game-input",
    roomCode: room.code,
    input: message.input,
    timestamp: Date.now(),
  };
  sendToPlayer(room.hostId, inputMsg);
}

function handleStartGame(ws: WebSocket, gameId?: string, gameName?: string, romUrl?: string) {
  const clientData = clients.get(ws);
  if (!clientData || !clientData.roomCode) {
    sendError(ws, "Not in a room");
    return;
  }

  const room = rooms.get(clientData.roomCode);
  if (!room) {
    sendError(ws, "Room not found");
    return;
  }

  if (room.hostId !== clientData.playerId) {
    sendError(ws, "Only the host can start the game");
    return;
  }

  room.state = "playing";
  room.gameId = gameId;
  room.gameName = gameName;

  const gameStartedMsg: MultiplayerMessage = {
    type: "game-started",
    roomCode: room.code,
    room,
    gameId,
    gameName,
    romUrl,
  };
  
  broadcastToRoom(room.code, gameStartedMsg);
  log(`Game started in room ${room.code}: ${gameName || gameId || "unknown"}`);
}

function handlePing(ws: WebSocket, timestamp?: number) {
  const pongMsg: MultiplayerMessage = {
    type: "pong",
    timestamp: timestamp || Date.now(),
  };
  ws.send(JSON.stringify(pongMsg));
}

// WebRTC signaling relay - forward offer/answer/ice messages between peers
function handleRtcSignal(ws: WebSocket, message: { type: string; targetId: string; sdp?: any; candidate?: any }) {
  const clientData = clients.get(ws);
  if (!clientData || !clientData.roomCode) {
    sendError(ws, "Not in a room");
    return;
  }

  const room = rooms.get(clientData.roomCode);
  if (!room) {
    sendError(ws, "Room not found");
    return;
  }

  const targetPlayer = room.players.find((p) => p.id === message.targetId);
  if (!targetPlayer) {
    sendError(ws, "Target player not found");
    return;
  }

  // Forward the message to the target peer with sender's ID
  const relayMsg = {
    type: message.type,
    fromId: clientData.playerId,
    sdp: message.sdp,
    candidate: message.candidate,
  };
  sendToPlayer(message.targetId, relayMsg as any);
  log(`Relayed ${message.type} from ${clientData.playerId} to ${message.targetId}`);
}

function handleMessage(ws: WebSocket, data: string) {
  try {
    const message: MultiplayerMessage & { playerName?: string; gameId?: string; gameName?: string } = JSON.parse(data);

    switch (message.type) {
      case "create-room":
        handleCreateRoom(ws, message.playerName || "Host", message.gameId, message.gameName);
        break;
      case "join-room":
        if (message.roomCode) {
          handleJoinRoom(ws, message.roomCode, message.playerName || "Guest");
        }
        break;
      case "leave-room":
        handleLeaveRoom(ws);
        break;
      case "signal":
        if (message.signal) {
          handleSignal(ws, message.signal);
        }
        break;
      case "game-input":
        handleGameInput(ws, message);
        break;
      case "start-game":
        handleStartGame(ws, message.gameId, message.gameName, (message as any).romUrl);
        break;
      case "ping":
        handlePing(ws, message.timestamp);
        break;
      // WebRTC signaling relay
      case "rtc-offer":
      case "rtc-answer":
      case "rtc-ice":
        handleRtcSignal(ws, message as any);
        break;
      default:
        log(`Unknown message type: ${(message as any).type}`);
    }
  } catch (err) {
    log(`Invalid message: ${err}`);
    sendError(ws, "Invalid message format");
  }
}

function cleanupStaleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.createdAt > ROOM_TIMEOUT_MS) {
      log(`Cleaning up stale room ${code}`);
      rooms.delete(code);
    }
  }
}

setInterval(cleanupStaleRooms, 300000);

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS[0] !== "*" && !ALLOWED_ORIGINS.includes(origin)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0] === "*" ? "*" : origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "n64vault-multiplayer",
      rooms: rooms.size,
      players: clients.size,
      uptime: process.uptime(),
    }));
    return;
  }

  if (req.url === "/stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      rooms: Array.from(rooms.values()).map((r) => ({
        code: r.code,
        players: r.players.length,
        state: r.state,
        createdAt: r.createdAt,
      })),
    }));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws/multiplayer" });

wss.on("connection", (ws, req) => {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS[0] !== "*" && !ALLOWED_ORIGINS.includes(origin)) {
    ws.close(1008, "Origin not allowed");
    return;
  }

  const playerId = generatePlayerId();
  clients.set(ws, { playerId, roomCode: null });
  playerSockets.set(playerId, ws);

  log(`Player connected: ${playerId}`);

  ws.on("message", (data) => {
    handleMessage(ws, data.toString());
  });

  ws.on("close", () => {
    const clientData = clients.get(ws);
    if (clientData) {
      if (clientData.roomCode) {
        handleLeaveRoom(ws);
      }
      playerSockets.delete(clientData.playerId);
      clients.delete(ws);
      log(`Player disconnected: ${clientData.playerId}`);
    }
  });

  ws.on("error", (err) => {
    log(`WebSocket error: ${err.message}`);
  });

  ws.on("pong", () => {
    // Keep-alive response received
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, 30000);

httpServer.listen(PORT, () => {
  log(`N64Vault Multiplayer Server running on port ${PORT}`);
  log(`WebSocket endpoint: ws://localhost:${PORT}/ws/multiplayer`);
  log(`Health check: http://localhost:${PORT}/health`);
});
