'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new Map();
// Tracks used question IDs plus the immediately previous set to reduce repetition across online sessions.
let recentlyUsedQuestionIds = [];
const usedQuestionIds = new Set();

app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'team-detective-showdown' }));
app.get('/player', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));

function cleanNames(value) {
  if (!Array.isArray(value)) return null;
  const names = value.map(name => String(name || '').trim());
  if (names.length < 4 || names.length > 20) return null;
  if (names.some(name => !name || name.length > 20)) return null;
  const folded = names.map(name => name.toLocaleLowerCase());
  if (new Set(folded).size !== names.length) return null;
  return names;
}
function makeRoomCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (rooms.has(code));
  return code;
}
function socketRoom(socket) {
  const code = socket.data && socket.data.roomCode;
  return code ? rooms.get(code) : null;
}
function publicRoster(room) {
  return room.players.map((player, index) => ({
    name: player.name,
    connected: Boolean(room.playerSockets.get(index))
  }));
}
function broadcastConnected(room) {
  const connected = room.playerSockets.size;
  const info = { connected, total: room.players.length, roster: publicRoster(room) };
  if (room.hostSocketId) io.to(room.hostSocketId).emit('room:players', info);
  io.to(room.code).emit('room:players', info);
}
function joinBaseUrl(socket, hintedBase) {
  // The host's browser origin is supplied by the running page; fall back to forwarded proxy headers.
  let base = '';
  try {
    const u = new URL(String(hintedBase || socket.handshake.headers.origin || ''));
    if (u.protocol === 'https:' || u.protocol === 'http:') base = u.origin;
  } catch (_) {}
  if (!base) {
    const forwarded = String(socket.request.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = String(socket.request.headers['x-forwarded-host'] || socket.request.headers.host || `localhost:${PORT}`).split(',')[0].trim();
    base = `${forwarded}://${host}`;
  }
  return base;
}

io.on('connection', socket => {
  socket.on('host:create', async (payload, callback) => {
    try {
      const names = cleanNames(payload && payload.players);
      if (!names) {
        if (typeof callback === 'function') callback({ ok: false, error: 'The registered player list must contain 4–20 unique names.' });
        return;
      }
      // Each host socket may own only one room at a time.
      const previous = socketRoom(socket);
      if (previous && previous.hostSocketId === socket.id) {
        if (typeof callback === 'function') callback({ ok: false, error: 'This host already has a room open.' });
        return;
      }
      const code = makeRoomCode();
      const baseUrl = joinBaseUrl(socket, payload && payload.hostBase);
      const joinUrl = `${baseUrl}/player.html?room=${code}`;
      const qrData = await QRCode.toDataURL(joinUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 });
      const room = {
        code,
        hostSocketId: socket.id,
        players: names.map((name, index) => ({ name, index })),
        playerSockets: new Map(),
        publicState: { phase: 'ROUND_INTRO', roundName: 'Murder Mysteries', prompt: '', options: [], players: names.map(name => ({ name })) },
        createdAt: Date.now()
      };
      rooms.set(code, room);
      socket.join(code);
      socket.data.role = 'host';
      socket.data.roomCode = code;
      if (typeof callback === 'function') callback({ ok: true, roomCode: code, joinUrl, qrData, avoidIds: recentlyUsedQuestionIds.slice(), usedIds: Array.from(usedQuestionIds) });
      broadcastConnected(room);
    } catch (error) {
      if (typeof callback === 'function') callback({ ok: false, error: 'The room or QR code could not be created. Please try again.' });
    }
  });

  socket.on('host:questions-selected', payload => {
    const room = socketRoom(socket);
    if (!room || room.hostSocketId !== socket.id || !Array.isArray(payload && payload.questionIds)) return;
    recentlyUsedQuestionIds = payload.questionIds.map(String).filter(id => /^[A-Z0-9_-]{2,16}$/.test(id)).slice(0, 100);
    recentlyUsedQuestionIds.forEach(id => usedQuestionIds.add(id));
  });

  socket.on('host:update', payload => {
    if (!payload || typeof payload.roomCode !== 'string' || !payload.payload || typeof payload.payload !== 'object') return;
    const room = rooms.get(payload.roomCode);
    if (!room || room.hostSocketId !== socket.id || socket.data.role !== 'host') return;
    const data = payload.payload;
    // Bound strings and array sizes before storing or broadcasting shared state.
    const safe = {
      phase: String(data.phase || 'ROUND_INTRO').slice(0, 32),
      round: Number(data.round) || 1,
      roundName: String(data.roundName || '').slice(0, 80),
      questionNumber: Number(data.questionNumber) || 1,
      totalQuestions: 45,
      questionId: data.questionId == null ? null : String(data.questionId).slice(0, 16),
      difficulty: String(data.difficulty || '').slice(0, 24),
      region: String(data.region || '').slice(0, 80),
      prompt: String(data.prompt || '').slice(0, 1600),
      options: Array.isArray(data.options) ? data.options.slice(0, 4).map(x => String(x).slice(0, 240)) : [],
      correctIndex: Number.isInteger(data.correctIndex) && data.correctIndex >= 0 && data.correctIndex < 4 ? data.correctIndex : null,
      explanation: String(data.explanation || '').slice(0, 900),
      locked: Boolean(data.locked),
      acceptingAnswers: Boolean(data.acceptingAnswers),
      paused: Boolean(data.paused),
      timeLeftMs: Math.max(0, Math.min(60000, Number(data.timeLeftMs) || 0)),
      answered: Array.isArray(data.answered) ? data.answered.slice(0, 20).map(Boolean) : [],
      eligiblePlayers: Array.isArray(data.eligiblePlayers) ? data.eligiblePlayers.slice(0, 20).map(Number).filter(Number.isInteger) : null,
      players: Array.isArray(data.players) ? data.players.slice(0, 20).map(p => ({ name: String(p.name || '').slice(0, 20), score: Number(p.score) || 0, avatar: String(p.avatar || '👤').slice(0, 8), color: /^#[0-9a-fA-F]{6}$/.test(String(p.color || '')) ? p.color : '#eabf62' })) : []
    };
    room.publicState = safe;
    io.to(room.code).emit('game:update', safe);
  });

  socket.on('player:room-info', (payload, callback) => {
    const code = String(payload && payload.roomCode || '').trim();
    const room = rooms.get(code);
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'That room was not found. Ask the host to reopen the QR code.' });
      return;
    }
    if (typeof callback === 'function') callback({ ok: true, roomCode: room.code, players: publicRoster(room), gameState: room.publicState });
  });

  socket.on('player:join', (payload, callback) => {
    const code = String(payload && payload.roomCode || '').trim();
    const name = String(payload && payload.name || '').trim();
    const room = rooms.get(code);
    if (!room) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Room not found. Scan the host’s current QR code.' });
      return;
    }
    const index = room.players.findIndex(player => player.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (index < 0) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Choose a name from the host’s registered player list.' });
      return;
    }
    const owner = room.playerSockets.get(index);
    if (owner && owner !== socket.id) {
      if (typeof callback === 'function') callback({ ok: false, error: 'That player is already connected. Ask them to close the other session first.' });
      return;
    }
    socket.data.role = 'player';
    socket.data.roomCode = code;
    socket.data.playerIndex = index;
    room.playerSockets.set(index, socket.id);
    socket.join(code);
    if (typeof callback === 'function') callback({ ok: true, playerIndex: index, name: room.players[index].name, gameState: room.publicState });
    socket.emit('game:update', room.publicState);
    broadcastConnected(room);
  });

  socket.on('player:answer', (payload, callback) => {
    const room = socketRoom(socket);
    const playerIndex = socket.data.playerIndex;
    if (!room || socket.data.role !== 'player' || !Number.isInteger(playerIndex) || room.playerSockets.get(playerIndex) !== socket.id) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Join the room again before answering.' });
      return;
    }
    const game = room.publicState;
    const optionIndex = Number(payload && payload.optionIndex);
    const questionId = String(payload && payload.questionId || '');
    const isQuestion = game.phase === 'QUESTION' || game.phase === 'TIEBREAKER';
    if (!isQuestion || !game.acceptingAnswers || game.locked || game.paused || !game.questionId || game.questionId !== questionId || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Answers are locked or the question has changed.' });
      return;
    }
    if (game.phase === 'TIEBREAKER' && Array.isArray(game.eligiblePlayers) && !game.eligiblePlayers.includes(playerIndex)) {
      if (typeof callback === 'function') callback({ ok: false, error: 'Only players in this tie-breaker may answer.' });
      return;
    }
    // Answer letters are sent only to the host; no other player receives another player's selection.
    io.to(room.hostSocketId).emit('mobile:answer', { playerIndex, optionIndex, questionId, phase: game.phase });
    if (typeof callback === 'function') callback({ ok: true, message: 'Answer sent to the host. You may change it until the host locks the question.' });
  });

  socket.on('disconnect', () => {
    const room = socketRoom(socket);
    if (!room) return;
    if (room.hostSocketId === socket.id) {
      io.to(room.code).emit('room:closed');
      rooms.delete(room.code);
      return;
    }
    const idx = socket.data.playerIndex;
    if (Number.isInteger(idx) && room.playerSockets.get(idx) === socket.id) {
      room.playerSockets.delete(idx);
      broadcastConnected(room);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Team Detective Showdown is listening on port ${PORT}`);
});
