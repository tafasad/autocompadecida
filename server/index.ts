// Importação dos módulos: Express, HTTP, WebSocket e constantes compartilhadas
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import crypto from "crypto";
import { WS_EVENTS, ADMIN_PASSWORD, type WsMessage } from "../shared/const.js";
import { saveAudio, getAudio, deleteAudio, listAudio } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Informações de cada cliente conectado via WebSocket
type ClientInfo = {
  ws: WebSocket;
  clientId: string;
  role: "admin" | "user";
};

let tokenHolderId: string | null = null; // ID do cliente que detém o token de áudio
const clients = new Map<string, ClientInfo>(); // Todos os clientes conectados

// Envia uma mensagem para todos os clientes conectados (exceto quem excluir)
function broadcast(msg: WsMessage, excludeId?: string) {
  const raw = JSON.stringify(msg);
  for (const [id, info] of clients) {
    if (id === excludeId) continue;
    if (info.ws.readyState === WebSocket.OPEN) {
      info.ws.send(raw);
    }
  }
}

// Envia mensagem para um WebSocket específico
function sendTo(ws: WebSocket, msg: WsMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// Kill Switch: libera o token e avisa todos os clientes para pararem toda a mídia
function stopAllMediaAndKillToken() {
  tokenHolderId = null;
  broadcast({ type: WS_EVENTS.KILL_AUDIO_BROADCAST as typeof WS_EVENTS.KILL_AUDIO_BROADCAST });
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  // Caminho dos arquivos estáticos (HTML/JS/CSS buildados)
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Servidor WebSocket na rota /ws para comunicação em tempo real
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    const clientId = crypto.randomUUID();
    let role: "admin" | "user" = "user";

    clients.set(clientId, { ws, clientId, role });

    // Informa o novo cliente sobre o estado atual do token
    sendTo(ws, { type: WS_EVENTS.TOKEN_HOLDER as typeof WS_EVENTS.TOKEN_HOLDER, holderId: tokenHolderId ?? undefined, clientId });

    // Processa mensagens recebidas do cliente
    ws.on("message", (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        sendTo(ws, { type: WS_EVENTS.ERROR as typeof WS_EVENTS.ERROR, message: "invalid message" });
        return;
      }

      switch (msg.type) {
        // Solicitação de token de áudio (apenas admin)
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

        // Liberação do token de áudio
        case WS_EVENTS.TOKEN_RELEASE: {
          if (tokenHolderId === clientId) {
            tokenHolderId = null;
            broadcast({ type: WS_EVENTS.TOKEN_RELEASED as typeof WS_EVENTS.TOKEN_RELEASED });
          }
          break;
        }

        // Kill Switch público: qualquer cliente pode disparar
        case WS_EVENTS.KILL_AUDIO: {
          stopAllMediaAndKillToken();
          break;
        }

        default:
          sendTo(ws, { type: WS_EVENTS.ERROR as typeof WS_EVENTS.ERROR, message: `unknown event: ${msg.type}` });
      }
    });

    // Ao desconectar: limpa os dados do cliente e libera o token se era dele
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

  // Endpoint REST para login de administrador
  app.post("/api/admin/login", (req, res) => {
    const { password } = req.body ?? {};
    if (password === ADMIN_PASSWORD) {
      res.json({ success: true, role: "admin" });
    } else {
      res.status(401).json({ success: false, message: "Invalid password" });
    }
  });

  // Configuração do multer para upload de áudio
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // Listar todos os áudios
  app.get("/api/audio", (_req, res) => {
    const items = listAudio();
    res.json(items.map(item => ({ ...item, url: `/api/audio/${item.id}` })));
  });

  // Upload de áudio
  app.post("/api/audio/upload", upload.single("audio"), (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Nenhum arquivo enviado" });
        return;
      }
      const id = crypto.randomUUID();
      const meta = saveAudio(id, {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        buffer: req.file.buffer,
      });
      res.json({ ...meta, url: `/api/audio/${id}` });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Download de áudio
  app.get("/api/audio/:id", (req, res) => {
    const result = getAudio(req.params.id);
    if (!result) {
      res.status(404).json({ error: "Áudio não encontrado" });
      return;
    }
    res.setHeader("Content-Type", result.meta.mimetype);
    res.setHeader("Content-Disposition", `inline; filename="${result.meta.name}"`);
    res.sendFile(result.filePath);
  });

  // Deletar áudio
  app.delete("/api/audio/:id", (req, res) => {
    const ok = deleteAudio(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Áudio não encontrado" });
      return;
    }
    res.json({ success: true });
  });

  // Fallback: serve o index.html para qualquer rota não reconhecida (SPA)
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
