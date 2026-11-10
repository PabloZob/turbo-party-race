import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONSTANTES & MODÈLES DE DONNÉES
// ============================================================================

export const CAR_COLORS = [
  '#FF3366',
  '#00E5FF',
  '#FFD600',
  '#00E676',
  '#FF9100',
  '#D500F9',
  '#2979FF',
  '#FF1744'
];

export const BOT_NAMES = [
  '🤖 TurboBot',
  '🤖 DriftKing',
  '🤖 NitroMax',
  '🤖 CyberKart',
  '🤖 ApexAI',
  '🤖 VortexIA',
  '🤖 PixelRacer',
  '🤖 RocketBot'
];

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface PlayerInput {
  left: boolean;
  right: boolean;
  accel: boolean;
  drift: boolean;
}

export interface PlayerInfo {
  id: string;          // playerToken UUID ou "bot-xxx"
  socketId: string;    // socket.id actuel ou "bot"
  name: string;
  color: string;
  slotIndex: number;   // 0..7
  isBot: boolean;
  isCreator: boolean;  // true pour le 1er joueur humain du salon
  connected: boolean;  // false pendant les 10s de coupure 4G
  position: number;    // 1..8
  lap: number;         // 1..3
  item: 'nitro' | 'oil' | 'shockwave' | null;
  finished: boolean;
  input: PlayerInput;
}

export interface RoomState {
  roomCode: string;
  status: 'lobby' | 'countdown' | 'racing' | 'finished';
  players: PlayerInfo[];
  maxPlayers: number;
}

interface InternalRoom extends RoomState {
  hostSocketId: string;
  hostConnected: boolean;
  createdAt: number;
}

// Stockage en mémoire des salons et des timers de tolérance aux pannes
const rooms = new Map<string, InternalRoom>();
const disconnectTimers = new Map<string, NodeJS.Timeout>();
const hostDisconnectTimers = new Map<string, NodeJS.Timeout>();
const socketToPlayer = new Map<string, { roomCode: string; playerId: string }>();

// ============================================================================
// FONCTIONS UTILITAIRES
// ============================================================================

function createDefaultInput(): PlayerInput {
  return { left: false, right: false, accel: false, drift: false };
}

function generateRoomCode(): string {
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      const idx = Math.floor(Math.random() * ROOM_CODE_CHARS.length);
      code += ROOM_CODE_CHARS[idx];
    }
  } while (rooms.has(code));
  return code;
}

function serializeRoom(room: InternalRoom): RoomState & { state: RoomState } {
  const base: RoomState = {
    roomCode: room.roomCode,
    status: room.status,
    players: room.players.map((p) => ({
      ...p,
      input: { ...p.input }
    })),
    maxPlayers: room.maxPlayers
  };
  return {
    ...base,
    state: base
  };
}

function findAvailableSlotIndex(room: InternalRoom): number {
  const usedSlots = new Set(room.players.map((p) => p.slotIndex));
  for (let i = 0; i < room.maxPlayers; i++) {
    if (!usedSlots.has(i)) {
      return i;
    }
  }
  return room.players.length % CAR_COLORS.length;
}

function findRoomForHost(socket: Socket, roomCode?: string): InternalRoom | undefined {
  if (roomCode && typeof roomCode === 'string') {
    const normalized = roomCode.trim().toUpperCase();
    const room = rooms.get(normalized);
    if (room) return room;
  }
  for (const room of rooms.values()) {
    if (room.hostSocketId === socket.id) {
      return room;
    }
  }
  return undefined;
}

function findPlayerAndRoom(
  socket: Socket,
  roomCode?: string,
  playerToken?: string
): { room: InternalRoom; player: PlayerInfo } | undefined {
  if (roomCode && typeof roomCode === 'string') {
    const room = rooms.get(roomCode.trim().toUpperCase());
    if (room) {
      const player = room.players.find(
        (p) => !p.isBot && ((playerToken && p.id === playerToken) || p.socketId === socket.id)
      );
      if (player) return { room, player };
    }
  }

  const mapped = socketToPlayer.get(socket.id);
  if (mapped) {
    const room = rooms.get(mapped.roomCode);
    if (room) {
      const player = room.players.find((p) => p.id === mapped.playerId);
      if (player) return { room, player };
    }
  }

  for (const room of rooms.values()) {
    const player = room.players.find(
      (p) => !p.isBot && ((playerToken && p.id === playerToken) || p.socketId === socket.id)
    );
    if (player) return { room, player };
  }

  return undefined;
}

function clearPlayerDisconnectTimer(roomCode: string, playerId: string): void {
  const key = `${roomCode}:${playerId}`;
  const timer = disconnectTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(key);
  }
}

function clearHostDisconnectTimer(roomCode: string): void {
  const timer = hostDisconnectTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    hostDisconnectTimers.delete(roomCode);
  }
}

function clearAllRoomTimers(roomCode: string): void {
  clearHostDisconnectTimer(roomCode);
  const prefix = `${roomCode}:`;
  for (const [key, timer] of disconnectTimers.entries()) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      disconnectTimers.delete(key);
    }
  }
}

function reassignCreatorIfNeeded(room: InternalRoom): void {
  const hasCreator = room.players.some((p) => !p.isBot && p.isCreator);
  if (!hasCreator) {
    const nextHuman =
      room.players.find((p) => !p.isBot && p.connected) ||
      room.players.find((p) => !p.isBot);
    if (nextHuman) {
      nextHuman.isCreator = true;
    }
  }
}

// ============================================================================
// CONFIGURATION EXPRESS & SOCKET.IO (CLOUD REVERSE PROXY READY)
// ============================================================================

const app = express();

// Indispensable pour Render, Railway, Fly.io, Heroku, Nginx
app.set('trust proxy', 1);

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// Routes principales HTML
app.get(['/', '/host'], (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'host.html'));
});

app.get('/play', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'play.html'));
});

// Route Keep-Alive (utilisée toutes les 30s par la TV sur Render)
app.get('/api/ping', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    timestamp: Date.now(),
    rooms: rooms.size
  });
});

// Route de génération QR Code (DataURL + SVG)
app.get('/api/qr', async (req: Request, res: Response) => {
  try {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    const fallbackUrl = `${req.protocol}://${req.get('host')}/play`;
    const targetUrl = rawUrl || fallbackUrl;

    const dataUrl = await QRCode.toDataURL(targetUrl, {
      margin: 1,
      width: 320,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    const svg = await QRCode.toString(targetUrl, {
      type: 'svg',
      margin: 1
    });

    res.json({ ok: true, dataUrl, svg });
  } catch (err) {
    console.error('[QR Error]', err);
    res.status(500).json({ ok: false, error: 'Impossible de générer le QR Code' });
  }
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout: 15000,
  pingInterval: 10000
});

// ============================================================================
// GESTION DES ÉVÉNEMENTS TEMPS RÉEL SOCKET.IO
// ============================================================================

io.on('connection', (socket: Socket) => {
  // --------------------------------------------------------------------------
  // 1. ÉVÉNEMENTS ÉCRAN HÔTE (TV / PC)
  // --------------------------------------------------------------------------

  socket.on(
    'host:create_room',
    (
      payloadOrAck?: { existingRoomCode?: string; roomCode?: string } | ((res: unknown) => void),
      maybeAck?: (res: unknown) => void
    ) => {
      const payload = typeof payloadOrAck === 'object' && payloadOrAck !== null ? payloadOrAck : {};
      const ack = typeof payloadOrAck === 'function' ? payloadOrAck : maybeAck;

      const requestedCode = (payload.existingRoomCode || payload.roomCode || '')
        .trim()
        .toUpperCase();

      if (requestedCode && rooms.has(requestedCode)) {
        const room = rooms.get(requestedCode)!;
        clearHostDisconnectTimer(requestedCode);
        room.hostSocketId = socket.id;
        room.hostConnected = true;
        socket.join(requestedCode);

        const serialized = serializeRoom(room);
        const responsePayload = {
          ok: true,
          roomCode: requestedCode,
          ...serialized
        };

        socket.emit('room:created', responsePayload);
        socket.emit('room:state', serialized);
        if (typeof ack === 'function') ack(responsePayload);
        return;
      }

      const roomCode = generateRoomCode();
      const newRoom: InternalRoom = {
        roomCode,
        status: 'lobby',
        players: [],
        maxPlayers: 8,
        hostSocketId: socket.id,
        hostConnected: true,
        createdAt: Date.now()
      };

      rooms.set(roomCode, newRoom);
      socket.join(roomCode);

      const serialized = serializeRoom(newRoom);
      const responsePayload = {
        ok: true,
        roomCode,
        ...serialized
      };

      socket.emit('room:created', responsePayload);
      socket.emit('room:state', serialized);
      if (typeof ack === 'function') ack(responsePayload);
    }
  );

  socket.on(
    'host:add_bot',
    (payload?: { roomCode?: string }, ack?: (res: unknown) => void) => {
      const room = findRoomForHost(socket, payload?.roomCode);
      if (!room || room.players.length >= room.maxPlayers) {
        if (typeof ack === 'function') {
          ack({ ok: false, error: 'Salon introuvable ou complet (8/8).' });
        }
        return;
      }

      const slotIndex = findAvailableSlotIndex(room);
      const usedNames = new Set(room.players.map((p) => p.name));
      const availableName =
        BOT_NAMES.find((n) => !usedNames.has(n)) ||
        BOT_NAMES[slotIndex % BOT_NAMES.length];

      const bot: PlayerInfo = {
        id: 'bot-' + Math.random().toString(36).slice(2, 8),
        socketId: 'bot',
        name: availableName,
        color: CAR_COLORS[slotIndex] || CAR_COLORS[0],
        slotIndex,
        isBot: true,
        isCreator: false,
        connected: true,
        position: room.players.length + 1,
        lap: 1,
        item: null,
        finished: false,
        input: createDefaultInput()
      };

      room.players.push(bot);
      const serialized = serializeRoom(room);
      io.to(room.roomCode).emit('room:state', serialized);
      if (typeof ack === 'function') ack({ ok: true, bot, state: serialized });
    }
  );

  socket.on(
    'host:remove_bot',
    (payload?: { roomCode?: string; botId?: string }, ack?: (res: unknown) => void) => {
      const room = findRoomForHost(socket, payload?.roomCode);
      if (!room) {
        if (typeof ack === 'function') ack({ ok: false });
        return;
      }

      let removeIndex = -1;
      if (payload?.botId) {
        removeIndex = room.players.findIndex((p) => p.isBot && p.id === payload.botId);
      } else {
        for (let i = room.players.length - 1; i >= 0; i--) {
          if (room.players[i].isBot) {
            removeIndex = i;
            break;
          }
        }
      }

      if (removeIndex !== -1) {
        room.players.splice(removeIndex, 1);
        room.players.forEach((p, idx) => {
          p.position = idx + 1;
        });
      }

      const serialized = serializeRoom(room);
      io.to(room.roomCode).emit('room:state', serialized);
      if (typeof ack === 'function') ack({ ok: true, state: serialized });
    }
  );

  socket.on('host:start_race', (payload?: { roomCode?: string }) => {
    const room = findRoomForHost(socket, payload?.roomCode);
    if (!room) return;

    room.status = 'racing';
    room.players.forEach((p, idx) => {
      p.lap = 1;
      p.position = idx + 1;
      p.item = null;
      p.finished = false;
      p.input = createDefaultInput();
    });

    const serialized = serializeRoom(room);
    io.to(room.roomCode).emit('race:start', serialized);
    io.to(room.roomCode).emit('room:state', serialized);
  });

  socket.on(
    'host:restart_lobby',
    (payload?: { roomCode?: string; directRace?: boolean }) => {
      const room = findRoomForHost(socket, payload?.roomCode);
      if (!room) return;

      room.players.forEach((p, index) => {
        p.lap = 1;
        p.position = index + 1;
        p.item = null;
        p.finished = false;
        p.input = createDefaultInput();
      });

      if (payload?.directRace) {
        room.status = 'racing';
        const serialized = serializeRoom(room);
        io.to(room.roomCode).emit('race:start', serialized);
        io.to(room.roomCode).emit('room:state', serialized);
      } else {
        room.status = 'lobby';
        const serialized = serializeRoom(room);
        io.to(room.roomCode).emit('race:reset', serialized);
        io.to(room.roomCode).emit('room:state', serialized);
      }
    }
  );

  socket.on(
    'host:race_finished',
    (payload?: {
      roomCode?: string;
      rankings?: Array<{ id: string; position?: number; name?: string; color?: string }>;
    }) => {
      const room = findRoomForHost(socket, payload?.roomCode);
      if (!room) return;

      room.status = 'finished';

      if (Array.isArray(payload?.rankings)) {
        payload.rankings.forEach((r, idx) => {
          const p = room.players.find((player) => player.id === r.id);
          if (p) {
            p.position = typeof r.position === 'number' ? r.position : idx + 1;
            p.finished = true;
          }
        });
      }

      const serialized = serializeRoom(room);
      io.to(room.roomCode).emit('race:finished', {
        rankings: payload?.rankings || [],
        ...serialized
      });
      io.to(room.roomCode).emit('room:state', serialized);
    }
  );

  socket.on(
    'host:sync_telemetry',
    (payload?: {
      roomCode?: string;
      players?: Array<{
        id: string;
        position: number;
        lap: number;
        item: 'nitro' | 'oil' | 'shockwave' | null;
        finished: boolean;
      }>;
    }) => {
      const room = findRoomForHost(socket, payload?.roomCode);
      if (!room || !Array.isArray(payload?.players)) return;

      for (const t of payload.players) {
        const player = room.players.find((p) => p.id === t.id);
        if (player) {
          if (typeof t.position === 'number') player.position = t.position;
          if (typeof t.lap === 'number') player.lap = t.lap;
          if (t.item !== undefined) player.item = t.item;
          if (typeof t.finished === 'boolean') player.finished = t.finished;
        }
      }

      for (const p of room.players) {
        if (!p.isBot && p.connected && p.socketId) {
          io.to(p.socketId).emit('player:telemetry', {
            position: p.position,
            lap: p.lap,
            item: p.item,
            finished: p.finished,
            color: p.color,
            name: p.name,
            isCreator: p.isCreator,
            status: room.status
          });
        }
      }
    }
  );

  socket.on(
    'host:haptic',
    (payload?: {
      roomCode?: string;
      targetId?: string | 'all';
      playerId?: string;
      type?: string;
      pattern?: number[];
    }) => {
      const room = findRoomForHost(socket, payload?.roomCode);
      if (!room) return;

      const targetId = payload?.targetId || payload?.playerId || 'all';
      const type = payload?.type || 'impact';

      if (targetId === 'all') {
        io.to(room.roomCode).emit('controller:haptic', {
          type,
          pattern: payload?.pattern || [40, 30, 60]
        });
      } else {
        const targetPlayer = room.players.find(
          (p) => !p.isBot && (p.id === targetId || p.socketId === targetId)
        );
        if (targetPlayer && targetPlayer.socketId) {
          io.to(targetPlayer.socketId).emit('controller:haptic', {
            type,
            pattern: payload?.pattern || [35]
          });
        }
      }
    }
  );

  // --------------------------------------------------------------------------
  // 2. ÉVÉNEMENTS MANETTE SMARTPHONE (JOUEURS)
  // --------------------------------------------------------------------------

  socket.on(
    'player:join',
    (
      payload?: { roomCode?: string; name?: string; playerToken?: string },
      callback?: (res: unknown) => void
    ) => {
      const roomCode = (payload?.roomCode || '').trim().toUpperCase();
      const rawName = (payload?.name || '').trim().slice(0, 16);
      const playerToken = (payload?.playerToken || '').trim() || crypto.randomUUID();

      const room = rooms.get(roomCode);
      if (!room) {
        const errorRes = {
          ok: false,
          error: 'Salon introuvable. Vérifie le code à 4 lettres !'
        };
        socket.emit('player:joined', errorRes);
        if (typeof callback === 'function') callback(errorRes);
        return;
      }

      // CAS 1 : Reconnexion transparente (playerToken existe déjà dans le salon)
      const existingPlayer = room.players.find(
        (p) => !p.isBot && p.id === playerToken
      );

      if (existingPlayer) {
        clearPlayerDisconnectTimer(room.roomCode, existingPlayer.id);
        existingPlayer.socketId = socket.id;
        existingPlayer.connected = true;
        if (rawName) {
          existingPlayer.name = rawName;
        }
        reassignCreatorIfNeeded(room);

        socketToPlayer.set(socket.id, {
          roomCode: room.roomCode,
          playerId: existingPlayer.id
        });
        socket.join(room.roomCode);

        const serialized = serializeRoom(room);
        const reconnectedRes = {
          ok: true,
          reconnected: true,
          player: existingPlayer,
          roomCode: room.roomCode,
          state: serialized
        };

        socket.emit('player:joined', reconnectedRes);
        if (typeof callback === 'function') callback(reconnectedRes);

        io.to(room.roomCode).emit('room:state', serialized);
        io.to(room.hostSocketId).emit('host:player_reconnected', {
          playerId: existingPlayer.id,
          player: existingPlayer
        });
        return;
      }

      // CAS 2 : Nouveau joueur humain
      if (room.players.length >= room.maxPlayers) {
        // Si un Bot IA est présent en lobby, il cède automatiquement sa place au joueur humain
        const botIndex =
          room.status === 'lobby'
            ? room.players.map((p) => p.isBot).lastIndexOf(true)
            : -1;

        if (botIndex !== -1) {
          room.players.splice(botIndex, 1);
        } else {
          const fullRes = {
            ok: false,
            error: 'Ce salon est complet (8/8 pilotes) !'
          };
          socket.emit('player:joined', fullRes);
          if (typeof callback === 'function') callback(fullRes);
          return;
        }
      }

      const slotIndex = findAvailableSlotIndex(room);
      const color = CAR_COLORS[slotIndex] || CAR_COLORS[0];
      const isCreator = !room.players.some((p) => !p.isBot && p.isCreator);

      const newPlayer: PlayerInfo = {
        id: playerToken,
        socketId: socket.id,
        name: rawName || `Pilote ${slotIndex + 1}`,
        color,
        slotIndex,
        isBot: false,
        isCreator,
        connected: true,
        position: room.players.length + 1,
        lap: 1,
        item: null,
        finished: false,
        input: createDefaultInput()
      };

      room.players.push(newPlayer);
      socketToPlayer.set(socket.id, {
        roomCode: room.roomCode,
        playerId: newPlayer.id
      });
      socket.join(room.roomCode);

      const serialized = serializeRoom(room);
      const joinedRes = {
        ok: true,
        reconnected: false,
        player: newPlayer,
        roomCode: room.roomCode,
        state: serialized
      };

      socket.emit('player:joined', joinedRes);
      if (typeof callback === 'function') callback(joinedRes);

      io.to(room.roomCode).emit('room:state', serialized);
    }
  );

  socket.on(
    'player:input',
    (payload?: {
      roomCode?: string;
      playerToken?: string;
      input?: Partial<PlayerInput>;
      left?: boolean;
      right?: boolean;
      accel?: boolean;
      drift?: boolean;
    }) => {
      const found = findPlayerAndRoom(socket, payload?.roomCode, payload?.playerToken);
      if (!found) return;

      const { room, player } = found;
      const src = payload?.input || payload || {};

      player.input = {
        left: Boolean(src.left),
        right: Boolean(src.right),
        accel: Boolean(src.accel),
        drift: Boolean(src.drift)
      };

      io.to(room.hostSocketId).emit('host:player_input', {
        playerId: player.id,
        input: player.input
      });
    }
  );

  socket.on(
    'player:use_item',
    (payload?: { roomCode?: string; playerToken?: string }) => {
      const found = findPlayerAndRoom(socket, payload?.roomCode, payload?.playerToken);
      if (!found) return;

      const { room, player } = found;
      io.to(room.hostSocketId).emit('host:player_use_item', {
        playerId: player.id
      });
    }
  );

  socket.on(
    'player:honk',
    (payload?: { roomCode?: string; playerToken?: string }) => {
      const found = findPlayerAndRoom(socket, payload?.roomCode, payload?.playerToken);
      if (!found) return;

      const { room, player } = found;
      io.to(room.hostSocketId).emit('host:player_honk', {
        playerId: player.id
      });
    }
  );

  socket.on(
    'player:start_race',
    (payload?: { roomCode?: string; playerToken?: string }) => {
      const found = findPlayerAndRoom(socket, payload?.roomCode, payload?.playerToken);
      if (!found) return;

      const { room, player } = found;
      const firstHuman = room.players.find((p) => !p.isBot);
      if (player.isCreator || (firstHuman && firstHuman.id === player.id)) {
        io.to(room.hostSocketId).emit('host:trigger_start', {
          roomCode: room.roomCode
        });
      }
    }
  );

  socket.on(
    'player:restart_race',
    (payload?: { roomCode?: string; playerToken?: string }) => {
      const found = findPlayerAndRoom(socket, payload?.roomCode, payload?.playerToken);
      if (!found) return;

      const { room, player } = found;
      const firstHuman = room.players.find((p) => !p.isBot);
      if (player.isCreator || (firstHuman && firstHuman.id === player.id)) {
        io.to(room.hostSocketId).emit('host:trigger_restart', {
          roomCode: room.roomCode
        });
      }
    }
  );

  // --------------------------------------------------------------------------
  // 3. TOLÉRANCE AUX PANNES RÉSEAU 4G/5G (10s JOUEUR / 15s HÔTE)
  // --------------------------------------------------------------------------

  socket.on('disconnect', () => {
    // A. Vérifier si ce socket était l'écran Hôte (TV) d'un salon
    for (const [roomCode, room] of rooms.entries()) {
      if (room.hostSocketId === socket.id) {
        room.hostConnected = false;
        clearHostDisconnectTimer(roomCode);

        const hostTimer = setTimeout(() => {
          hostDisconnectTimers.delete(roomCode);
          const currentRoom = rooms.get(roomCode);
          if (currentRoom && !currentRoom.hostConnected) {
            io.to(roomCode).emit('room:closed', {
              roomCode,
              message: 'Le salon a été fermé par l’écran principal.'
            });
            clearAllRoomTimers(roomCode);
            rooms.delete(roomCode);
          }
        }, 15000);

        hostDisconnectTimers.set(roomCode, hostTimer);
      }
    }

    // B. Vérifier si ce socket était un joueur humain
    const found = findPlayerAndRoom(socket);
    socketToPlayer.delete(socket.id);

    if (!found) return;

    const { room, player } = found;
    player.connected = false;
    player.input = createDefaultInput();

    // Relâcher immédiatement l'accélérateur/direction côté TV pour éviter une voiture bloquée
    io.to(room.hostSocketId).emit('host:player_input', {
      playerId: player.id,
      input: player.input
    });

    // Diffuser l'état avec connected = false pour afficher "4G..." sur la TV
    io.to(room.roomCode).emit('room:state', serializeRoom(room));

    clearPlayerDisconnectTimer(room.roomCode, player.id);

    const timerKey = `${room.roomCode}:${player.id}`;
    const timer = setTimeout(() => {
      disconnectTimers.delete(timerKey);
      const activeRoom = rooms.get(room.roomCode);
      if (!activeRoom) return;

      const idx = activeRoom.players.findIndex(
        (p) => !p.isBot && p.id === player.id && !p.connected
      );
      if (idx === -1) return;

      const [removedPlayer] = activeRoom.players.splice(idx, 1);

      if (removedPlayer.isCreator) {
        reassignCreatorIfNeeded(activeRoom);
      }

      if (activeRoom.status === 'lobby') {
        activeRoom.players.forEach((p, i) => {
          p.position = i + 1;
        });
      }

      io.to(activeRoom.hostSocketId).emit('host:player_removed', {
        playerId: removedPlayer.id
      });
      io.to(activeRoom.roomCode).emit('room:state', serializeRoom(activeRoom));

      const hasHumans = activeRoom.players.some((p) => !p.isBot);
      if (!activeRoom.hostConnected && !hasHumans) {
        clearAllRoomTimers(activeRoom.roomCode);
        rooms.delete(activeRoom.roomCode);
      }
    }, 10000);

    disconnectTimers.set(timerKey, timer);
  });
});

// ============================================================================
// DÉMARRAGE DU SERVEUR HTTP / WEBSOCKET
// ============================================================================

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

httpServer.listen(PORT, HOST, () => {
  console.log(`🏎️  Turbo Party Race Server prêt sur http://${HOST}:${PORT}`);
});
