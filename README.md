# N64Vault Multiplayer Server

Standalone WebSocket signaling server for N64Vault multiplayer gaming.

## Features
- Room creation and management (6-character room codes)
- Up to 4 players per room
- WebRTC signaling for peer-to-peer connections
- Automatic host transfer when host disconnects
- Health check endpoint for monitoring
- Stale room cleanup (1 hour timeout)

## Deployment Options

### Deploy to Render (Recommended - Free Tier)

1. Fork this repo or push to your GitHub
2. Go to [render.com](https://render.com) and create a new Web Service
3. Connect your GitHub repo
4. Render will auto-detect the `render.yaml` configuration
5. Click "Create Web Service"

Your WebSocket URL will be: `wss://your-service-name.onrender.com/ws/multiplayer`

**Note:** Free tier sleeps after 15 minutes of inactivity. First connection may take ~30 seconds to wake.

### Deploy to Fly.io

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Login: `fly auth login`
3. Create app: `fly launch --name n64vault-multiplayer`
4. Deploy: `fly deploy`

Your WebSocket URL will be: `wss://n64vault-multiplayer.fly.dev/ws/multiplayer`

### Deploy to Railway

1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repo
4. Railway will auto-detect Node.js and build

Your WebSocket URL will be: `wss://your-project.up.railway.app/ws/multiplayer`

## Local Development

```bash
npm install
npm run dev
```

Server runs on `http://localhost:3001`

## Configuration

Set these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `ALLOWED_ORIGINS` | Comma-separated allowed origins | * (all) |

## API Endpoints

- `GET /` or `/health` - Health check (returns JSON status)
- `GET /stats` - Room statistics
- `WS /ws/multiplayer` - WebSocket endpoint

## WebSocket Messages

### Client → Server
- `{ type: "create-room", playerName: "Name", gameId?: "id", gameName?: "Game" }`
- `{ type: "join-room", roomCode: "ABC123", playerName: "Name" }`
- `{ type: "leave-room" }`
- `{ type: "signal", signal: { toId, type, data } }`
- `{ type: "game-input", input: { ... } }`
- `{ type: "ping", timestamp: number }`

### Server → Client
- `{ type: "room-created", roomCode, room, player }`
- `{ type: "room-joined", roomCode, room, player }`
- `{ type: "room-updated", roomCode, room }`
- `{ type: "player-joined", roomCode, room, player }`
- `{ type: "player-left", roomCode, room, player }`
- `{ type: "signal", roomCode, signal }`
- `{ type: "game-input", roomCode, input, timestamp }`
- `{ type: "pong", timestamp }`
- `{ type: "error", error: "message" }`

## Connecting from N64Vault

In your `index.html`, update the config:

```javascript
window.N64_VAULT_CONFIG = {
    multiplayerBackendUrl: 'wss://your-server.onrender.com',
    // ... rest of config
};
```
