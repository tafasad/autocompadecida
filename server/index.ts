import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { WS_EVENTS, ADMIN_PASSWORD, type WsMessage } from "../shared/const.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type ClientInfo = {
  ws: WebSocket;
  clientId: string;
  role: "admin" | "user";
};

let tokenHolderId: string | null = null;
const clients = new Map<string, ClientInfo>();

function broadcast(msg: WsMessage, excludeId?: string) {
  const raw = JSON.stringify(msg);
  for (const [id, info] of clients) {
    if (id === excludeId) continue;
    if (info.ws.readyState === WebSocket.OPEN) {
      info.ws.send(raw);
    }
  }
}

function sendTo(ws: WebSocket, msg: WsMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function stopAllMediaAndKillToken() {
  tokenHolderId = null;
  broadcast({ type: WS_EVENTS.KILL_AUDIO_BROADCAST as typeof WS_EVENTS.KILL_AUDIO_BROADCAST });
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    const clientId = crypto.randomUUID();
    let role: "admin" | "user" = "user";

    clients.set(clientId, { ws, clientId, role });

    sendTo(ws, { type: WS_EVENTS.TOKEN_HOLDER as typeof WS_EVENTS.TOKEN_HOLDER, holderId: tokenHolderId ?? undefined, clientId });

    ws.on("message", (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendTo(ws, { type: WS_EVENTS.ERROR as typeof WS_EVENTS.ERROR, message: "invalid message" });
        return;
      }

      switch (msg.type) {
        case WS_EVENTS.TOKEN_REQUEST: {
          if (msg.role !== "admin") {
            sendTo(ws, { type: WS_EVENTS.UNAUTHORIZED as typeof WS_EVENTS.UNAUTHORIZED, message: "Only admins can acquire the token" });
            return;
          }
          if (tokenHolderId) {
            sendTo(ws, { type: WS_EVENTS.TOKEN_BUSY as typeof WS_EVENTS.TOKEN_BUSY, holderId: tokenHolderId });
            return;
          }
          tokenHolderId = clientId;
          role = "admin";
          const info = clients.get(clientId);
          if (info) info.role = "admin";
          broadcast({ type: WS_EVENTS.TOKEN_ACQUIRED as typeof WS_EVENTS.TOKEN_ACQUIRED, holderId: clientId });
          break;
        }

        case WS_EVENTS.TOKEN_RELEASE: {
          if (tokenHolderId === clientId) {
            tokenHolderId = null;
            broadcast({ type: WS_EVENTS.TOKEN_RELEASED as typeof WS_EVENTS.TOKEN_RELEASED });
          }
          break;
        }

        case WS_EVENTS.KILL_AUDIO: {
          if (msg.role !== "admin") {
            sendTo(ws, { type: WS_EVENTS.UNAUTHORIZED as typeof WS_EVENTS.UNAUTHORIZED, message: "Only admins can trigger kill switch" });
            return;
          }
          stopAllMediaAndKillToken();
          break;
        }

        default:
          sendTo(ws, { type: WS_EVENTS.ERROR as typeof WS_EVENTS.ERROR, message: `unknown event: ${msg.type}` });
      }
    });

    ws.on("close", () => {
      clients.delete(clientId);
      if (tokenHolderId === clientId) {
        tokenHolderId = null;
        broadcast({ type: WS_EVENTS.TOKEN_RELEASED as typeof WS_EVENTS.TOKEN_RELEASED });
      }
    });

    ws.on("error", () => {
      clients.delete(clientId);
      if (tokenHolderId === clientId) {
        tokenHolderId = null;
        broadcast({ type: WS_EVENTS.TOKEN_RELEASED as typeof WS_EVENTS.TOKEN_RELEASED });
      }
    });
  });

  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body ?? {};
    if (password === ADMIN_PASSWORD) {
      res.json({ success: true, role: "admin" });
    } else {
      res.status(401).json({ success: false, message: "Invalid password" });
    }
  });

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
