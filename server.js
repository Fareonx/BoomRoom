const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// In-memory game rooms
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

io.on('connection', (socket) => {
  let currentRoomCode = null;

  // Create Room
  socket.on('create_room', ({ playerName }) => {
    const roomCode = generateRoomCode();
    currentRoomCode = roomCode;

    const room = {
      code: roomCode,
      hostId: socket.id,
      gameState: 'LOBBY', // LOBBY, PLAYING, ENDED
      settings: {
        rounds: 3,
        roundTimes: [180, 120, 60], // in seconds (3m, 2m, 1m)
        hostagesPerRound: [1, 1, 1],
        advancedRoles: {
          spies: true,
          shyGuy: true,
          agent: true
        }
      },
      players: new Map(),
      currentRound: 1,
      roundTimeRemaining: 180,
      timerInterval: null,
      roomA: {
        leaderId: null,
        votes: {}, // voterId -> candidateId
        selectedHostages: []
      },
      roomB: {
        leaderId: null,
        votes: {},
        selectedHostages: []
      },
      gameResult: null,
      pendingShares: new Map() // reqId -> { fromId, targetId, type, status }
    };

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName || 'Игрок 1',
      isHost: true,
      room: null,
      role: null,
      isLeader: false,
      agentUsedThisRound: false
    });

    rooms.set(roomCode, room);
    socket.join(roomCode);

    socket.emit('room_created', {
      roomCode,
      playerId: socket.id,
      isHost: true
    });

    broadcastRoomState(roomCode);
  });

  // Join Room
  socket.on('join_room', ({ roomCode, playerName }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return socket.emit('error_message', 'Комната не найдена! Проверьте код.');
    }

    if (room.gameState !== 'LOBBY') {
      return socket.emit('error_message', 'Игра в этой комнате уже началась!');
    }

    currentRoomCode = code;
    socket.join(code);

    const isHost = room.players.size === 0;
    if (isHost) room.hostId = socket.id;

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName || `Игрок ${room.players.size + 1}`,
      isHost,
      room: null,
      role: null,
      isLeader: false,
      agentUsedThisRound: false
    });

    socket.emit('room_joined', {
      roomCode: code,
      playerId: socket.id,
      isHost
    });

    broadcastRoomState(code);
  });

  // Update Settings (Host only)
  socket.on('update_settings', ({ settings }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== socket.id || room.gameState !== 'LOBBY') return;

    if (settings.rounds) room.settings.rounds = Math.max(1, Math.min(5, settings.rounds));
    if (settings.roundTimes) room.settings.roundTimes = settings.roundTimes;
    if (settings.hostagesPerRound) room.settings.hostagesPerRound = settings.hostagesPerRound;
    if (settings.advancedRoles) {
      room.settings.advancedRoles = {
        ...room.settings.advancedRoles,
        ...settings.advancedRoles
      };
    }

    broadcastRoomState(currentRoomCode);
  });

  // Start Game (Host only)
  socket.on('start_game', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== socket.id || room.gameState !== 'LOBBY') return;

    const playerCount = room.players.size;
    if (playerCount < 4) {
      return socket.emit('error_message', 'Для игры нужно минимум 4 человека (рекомендуется 6-12)!');
    }

    assignRolesAndRooms(room);
    room.gameState = 'PLAYING';
    room.currentRound = 1;
    room.roundTimeRemaining = room.settings.roundTimes[0] || 180;
    room.roomA.selectedHostages = [];
    room.roomB.selectedHostages = [];
    room.roomA.votes = {};
    room.roomB.votes = {};
    room.roomA.leaderId = null;
    room.roomB.leaderId = null;

    startRoundTimer(room);
    broadcastRoomState(currentRoomCode);

    // Send secret roles to each player
    room.players.forEach((player) => {
      io.to(player.id).emit('your_secret_role', {
        role: player.role,
        room: player.room
      });
    });
  });

  // Leader Voting
  socket.on('vote_leader', ({ candidateId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const voter = room.players.get(socket.id);
    const candidate = room.players.get(candidateId);
    if (!voter || !candidate || voter.room !== candidate.room) return;

    const roomData = voter.room === 'A' ? room.roomA : room.roomB;
    roomData.votes[socket.id] = candidateId;

    // Recalculate leader
    recalculateLeader(room, voter.room);
    broadcastRoomState(currentRoomCode);
  });

  // Select Hostages (Leader only)
  socket.on('select_hostages', ({ hostageIds }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const player = room.players.get(socket.id);
    if (!player || !player.isLeader) return;

    const roomData = player.room === 'A' ? room.roomA : room.roomB;
    const maxHostages = room.settings.hostagesPerRound[room.currentRound - 1] || 1;

    // Filter valid hostage IDs (must be in same room, cannot be leader himself)
    const valid = hostageIds.filter(id => {
      const target = room.players.get(id);
      return target && target.room === player.room && id !== socket.id;
    }).slice(0, maxHostages);

    roomData.selectedHostages = valid;
    broadcastRoomState(currentRoomCode);
  });

  // Share Request (Color or Card) - to one or multiple targets in same room
  socket.on('request_share', ({ targetIds, type }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const sender = room.players.get(socket.id);
    if (!sender) return;

    // Check if sender is Shy Guy
    if (sender.role && sender.role.isShy) {
      return socket.emit('error_message', 'Вы Скромник! Вам строго запрещено показывать карту или цвет!');
    }

    if (!Array.isArray(targetIds) || targetIds.length === 0) return;

    targetIds.forEach(targetId => {
      const target = room.players.get(targetId);
      if (!target || target.room !== sender.room || target.id === sender.id) return;

      const reqId = `${socket.id}_${targetId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      room.pendingShares.set(reqId, {
        reqId,
        fromId: sender.id,
        fromName: sender.name,
        targetId: target.id,
        targetName: target.name,
        type // 'color' | 'card'
      });

      io.to(target.id).emit('incoming_share_request', {
        reqId,
        fromId: sender.id,
        fromName: sender.name,
        type
      });
    });

    socket.emit('share_request_sent', { count: targetIds.length, type });
  });

  // Respond to Share Request
  socket.on('respond_share_request', ({ reqId, accepted }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const shareReq = room.pendingShares.get(reqId);
    if (!shareReq || shareReq.targetId !== socket.id) return;

    const sender = room.players.get(shareReq.fromId);
    const target = room.players.get(shareReq.targetId);

    room.pendingShares.delete(reqId);

    if (!sender || !target || sender.room !== target.room) return;

    if (!accepted) {
      io.to(sender.id).emit('share_rejected', {
        targetName: target.name,
        type: shareReq.type
      });
      return;
    }

    // Check if target is Shy Guy
    if (target.role && target.role.isShy) {
      io.to(sender.id).emit('error_message', `${target.name} не может поделиться: игрок Скромник!`);
      socket.emit('error_message', 'Вы Скромник! Вам запрещено делиться информацией!');
      return;
    }

    // Mutual reveal!
    if (shareReq.type === 'color') {
      // Color share: apparentColor
      io.to(sender.id).emit('share_revealed', {
        fromPlayer: target.name,
        type: 'color',
        data: { color: target.role.apparentColor }
      });
      io.to(target.id).emit('share_revealed', {
        fromPlayer: sender.name,
        type: 'color',
        data: { color: sender.role.apparentColor }
      });
    } else if (shareReq.type === 'card') {
      // Full Card share
      io.to(sender.id).emit('share_revealed', {
        fromPlayer: target.name,
        type: 'card',
        data: {
          roleName: target.role.name,
          team: target.role.team,
          desc: target.role.desc
        }
      });
      io.to(target.id).emit('share_revealed', {
        fromPlayer: sender.name,
        type: 'card',
        data: {
          roleName: sender.role.name,
          team: sender.role.team,
          desc: sender.role.desc
        }
      });
    }
  });

  // Agent Interrogation Power
  socket.on('agent_interrogate', ({ targetId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const agent = room.players.get(socket.id);
    const target = room.players.get(targetId);

    if (!agent || !agent.role || !agent.role.isAgent) {
      return socket.emit('error_message', 'У вас нет полномочий Агента!');
    }

    if (agent.agentUsedThisRound) {
      return socket.emit('error_message', 'Вы уже использовали способность Агента в этом раунде!');
    }

    if (!target || target.room !== agent.room) {
      return socket.emit('error_message', 'Цель должна быть в вашей комнате!');
    }

    agent.agentUsedThisRound = true;

    if (target.role && target.role.isShy) {
      socket.emit('agent_result', {
        targetName: target.name,
        success: false,
        message: `${target.name} оказался Скромником! Он физически не может раскрыть карту.`
      });
      io.to(target.id).emit('agent_interrogated_you', {
        agentName: agent.name,
        blocked: true
      });
    } else {
      socket.emit('agent_result', {
        targetName: target.name,
        success: true,
        data: {
          roleName: target.role.name,
          team: target.role.team,
          desc: target.role.desc
        }
      });
      io.to(target.id).emit('agent_interrogated_you', {
        agentName: agent.name,
        blocked: false
      });
    }

    broadcastRoomState(currentRoomCode);
  });

  // Reset Game / Back to Lobby
  socket.on('restart_game', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== socket.id) return;

    if (room.timerInterval) clearInterval(room.timerInterval);

    room.gameState = 'LOBBY';
    room.currentRound = 1;
    room.gameResult = null;
    room.pendingShares.clear();

    room.players.forEach(p => {
      p.room = null;
      p.role = null;
      p.isLeader = false;
      p.agentUsedThisRound = false;
    });

    room.roomA = { leaderId: null, votes: {}, selectedHostages: [] };
    room.roomB = { leaderId: null, votes: {}, selectedHostages: [] };

    broadcastRoomState(currentRoomCode);
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    room.players.delete(socket.id);

    if (room.players.size === 0) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      rooms.delete(currentRoomCode);
    } else {
      if (room.hostId === socket.id) {
        const nextHost = room.players.keys().next().value;
        room.hostId = nextHost;
        const player = room.players.get(nextHost);
        if (player) player.isHost = true;
      }
      recalculateLeader(room, 'A');
      recalculateLeader(room, 'B');
      broadcastRoomState(currentRoomCode);
    }
  });
});

function recalculateLeader(room, roomLetter) {
  const roomData = roomLetter === 'A' ? room.roomA : room.roomB;
  const tally = {};

  Object.values(roomData.votes).forEach(candidateId => {
    tally[candidateId] = (tally[candidateId] || 0) + 1;
  });

  let maxVotes = 0;
  let topCandidate = null;

  for (const [candId, count] of Object.entries(tally)) {
    if (count > maxVotes) {
      maxVotes = count;
      topCandidate = candId;
    }
  }

  // Update leaders in player objects
  room.players.forEach(p => {
    if (p.room === roomLetter) {
      p.isLeader = (p.id === topCandidate);
    }
  });

  roomData.leaderId = topCandidate;
}

function assignRolesAndRooms(room) {
  const playerIds = shuffle(Array.from(room.players.keys()));
  const n = playerIds.length;

  // Split into Room A and Room B
  const half = Math.ceil(n / 2);
  const roomAPlayers = playerIds.slice(0, half);
  const roomBPlayers = playerIds.slice(half);

  roomAPlayers.forEach(id => {
    const p = room.players.get(id);
    p.room = 'A';
  });
  roomBPlayers.forEach(id => {
    const p = room.players.get(id);
    p.room = 'B';
  });

  // Setup roles
  const rolesList = [];

  // Core roles: President (Blue) and Bomber (Red)
  const presRole = {
    roleId: 'president',
    name: 'Президент',
    team: 'blue',
    apparentColor: 'blue',
    desc: 'Главная цель Синих! В конце 3-го раунда вы ОБЯЗАНЫ быть в комнате БЕЗ Бомбиста.'
  };

  const bomberRole = {
    roleId: 'bomber',
    name: 'Бомбист',
    team: 'red',
    apparentColor: 'red',
    desc: 'Главная цель Красных! В конце 3-го раунда вы ОБЯЗАНЫ оказаться в ОДНОЙ комнате с Президентом, чтобы взорвать его.'
  };

  // Place President in Room A and Bomber in Room B (standard recommendation)
  const presPlayerId = roomAPlayers[0];
  const bomberPlayerId = roomBPlayers[0];

  room.players.get(presPlayerId).role = presRole;
  room.players.get(bomberPlayerId).role = bomberRole;

  const remainingPlayers = shuffle([
    ...roomAPlayers.slice(1),
    ...roomBPlayers.slice(1)
  ]);

  const adv = room.settings.advancedRoles;

  // Spies
  if (adv.spies && remainingPlayers.length >= 2) {
    rolesList.push({
      roleId: 'red_spy',
      name: 'Красный Шпион',
      team: 'red',
      apparentColor: 'blue', // Deceptive!
      desc: 'Вы в команде Красных, НО при показе цвета (Color Share) вы светитесь СИНИМ! Обманывайте Синих и сдавайте позицию Президента.'
    });
    rolesList.push({
      roleId: 'blue_spy',
      name: 'Синий Шпион',
      team: 'blue',
      apparentColor: 'red', // Deceptive!
      desc: 'Вы в команде Синих, НО при показе цвета (Color Share) вы светитесь КРАСНЫМ! Проникайте в планы Красных и уводите Президента.'
    });
  }

  // Shy Guy & Agent
  if (adv.shyGuy && adv.agent && remainingPlayers.length >= (rolesList.length + 2)) {
    rolesList.push({
      roleId: 'shy_guy',
      name: 'Скромник',
      team: 'blue',
      apparentColor: 'blue',
      isShy: true,
      desc: 'Вам СТРОГО ЗАПРЕЩЕНО делиться картой или цветом! Кнопки показа заблокированы. Другие игроки могут выдавать себя за вас.'
    });
    rolesList.push({
      roleId: 'agent',
      name: 'Агент',
      team: 'red',
      apparentColor: 'red',
      isAgent: true,
      desc: 'Раз за раунд вы можете принудительно заставить любого игрока в вашей комнате раскрыть карту (если он не Скромник).'
    });
  }

  // Assign generated special roles
  rolesList.forEach(r => {
    if (remainingPlayers.length > 0) {
      const pid = remainingPlayers.pop();
      room.players.get(pid).role = r;
    }
  });

  // Balance the rest with guards and terrorists
  let blueCount = Array.from(room.players.values()).filter(p => p.role && p.role.team === 'blue').length;
  let redCount = Array.from(room.players.values()).filter(p => p.role && p.role.team === 'red').length;

  while (remainingPlayers.length > 0) {
    const pid = remainingPlayers.pop();
    if (blueCount <= redCount) {
      room.players.get(pid).role = {
        roleId: 'blue_guard',
        name: 'Агент охраны',
        team: 'blue',
        apparentColor: 'blue',
        desc: 'Обычный агент Синей команды. Защищайте Президента и вычисляйте шпионов.'
      };
      blueCount++;
    } else {
      room.players.get(pid).role = {
        roleId: 'red_terrorist',
        name: 'Боевик',
        team: 'red',
        apparentColor: 'red',
        desc: 'Обычный боец Красной команды. Помогайте Бомбисту найти Президента.'
      };
      redCount++;
    }
  }
}

function startRoundTimer(room) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.timerInterval = setInterval(() => {
    room.roundTimeRemaining--;

    if (room.roundTimeRemaining <= 0) {
      handleRoundEnd(room);
    } else {
      io.to(room.code).emit('timer_tick', {
        currentRound: room.currentRound,
        timeRemaining: room.roundTimeRemaining
      });
    }
  }, 1000);
}

function handleRoundEnd(room) {
  const maxRounds = room.settings.rounds;
  const currentR = room.currentRound;

  // Swap hostages
  exchangeHostages(room);

  if (currentR >= maxRounds) {
    // End Game!
    clearInterval(room.timerInterval);
    room.timerInterval = null;
    room.gameState = 'ENDED';

    // Evaluate winner
    let presRoom = null;
    let bomberRoom = null;

    room.players.forEach(p => {
      if (p.role && p.role.roleId === 'president') presRoom = p.room;
      if (p.role && p.role.roleId === 'bomber') bomberRoom = p.room;
    });

    const isBoom = (presRoom === bomberRoom);

    room.gameResult = {
      winner: isBoom ? 'red' : 'blue',
      title: isBoom ? '💥 БУМ! ПОБЕДА КРАСНЫХ!' : '🛡️ ПРЕЗИДЕНТ СПАСЕН! ПОБЕДА СИНИХ!',
      message: isBoom
        ? `Бомбист и Президент оказались вместе в Комнате ${presRoom}! Раздался взрыв.`
        : `Президент находился в Комнате ${presRoom}, а Бомбист — в Комнате ${bomberRoom}. Бомба взорвалась впустую!`,
      playersDebrief: Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        room: p.room,
        role: p.role
      }))
    };

    io.to(room.code).emit('game_ended', room.gameResult);
    broadcastRoomState(room.code);
  } else {
    // Advance to next round
    room.currentRound++;
    room.roundTimeRemaining = room.settings.roundTimes[room.currentRound - 1] || 60;

    // Reset round states
    room.players.forEach(p => {
      p.agentUsedThisRound = false;
    });
    room.roomA.selectedHostages = [];
    room.roomB.selectedHostages = [];

    io.to(room.code).emit('round_advanced', {
      currentRound: room.currentRound,
      timeRemaining: room.roundTimeRemaining
    });

    broadcastRoomState(room.code);
  }
}

function exchangeHostages(room) {
  const countNeeded = room.settings.hostagesPerRound[room.currentRound - 1] || 1;

  let hostagesA = [...room.roomA.selectedHostages];
  let hostagesB = [...room.roomB.selectedHostages];

  // If leader didn't select enough, pick random non-leaders
  const availableA = Array.from(room.players.values()).filter(p => p.room === 'A' && !p.isLeader).map(p => p.id);
  const availableB = Array.from(room.players.values()).filter(p => p.room === 'B' && !p.isLeader).map(p => p.id);

  while (hostagesA.length < countNeeded && availableA.length > 0) {
    const randomPick = availableA.splice(Math.floor(Math.random() * availableA.length), 1)[0];
    if (!hostagesA.includes(randomPick)) hostagesA.push(randomPick);
  }

  while (hostagesB.length < countNeeded && availableB.length > 0) {
    const randomPick = availableB.splice(Math.floor(Math.random() * availableB.length), 1)[0];
    if (!hostagesB.includes(randomPick)) hostagesB.push(randomPick);
  }

  // Move A to B
  hostagesA.forEach(id => {
    const p = room.players.get(id);
    if (p) p.room = 'B';
  });

  // Move B to A
  hostagesB.forEach(id => {
    const p = room.players.get(id);
    if (p) p.room = 'A';
  });

  // Clear selections
  room.roomA.selectedHostages = [];
  room.roomB.selectedHostages = [];
  room.roomA.votes = {};
  room.roomB.votes = {};
  recalculateLeader(room, 'A');
  recalculateLeader(room, 'B');

  // Notify players about hostage exchange
  io.to(room.code).emit('hostages_swapped', {
    fromAtoB: hostagesA.map(id => room.players.get(id)?.name),
    fromBtoA: hostagesB.map(id => room.players.get(id)?.name)
  });
}

function broadcastRoomState(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const publicPlayers = Array.from(room.players.values()).map(p => ({
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    room: p.room,
    isLeader: p.isLeader,
    votedFor: (p.room === 'A' ? room.roomA.votes[p.id] : room.roomB.votes[p.id]) || null
  }));

  const state = {
    code: room.code,
    hostId: room.hostId,
    gameState: room.gameState,
    settings: room.settings,
    currentRound: room.currentRound,
    roundTimeRemaining: room.roundTimeRemaining,
    players: publicPlayers,
    roomA: {
      leaderId: room.roomA.leaderId,
      selectedHostages: room.roomA.selectedHostages,
      playerCount: publicPlayers.filter(p => p.room === 'A').length
    },
    roomB: {
      leaderId: room.roomB.leaderId,
      selectedHostages: room.roomB.selectedHostages,
      playerCount: publicPlayers.filter(p => p.room === 'B').length
    },
    gameResult: room.gameResult
  };

  io.to(roomCode).emit('room_state_update', state);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Two Rooms and a Boom server running on http://localhost:${PORT}`);
});
