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
      gameState: 'LOBBY',
      settings: {
        rounds: 3,
        roundTimes: [180, 120, 60],
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
        votes: {},
        selectedHostages: []
      },
      roomB: {
        leaderId: null,
        votes: {},
        selectedHostages: []
      },
      gameResult: null,
      pendingShares: new Map()
    };

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName || 'Oyunçu 1',
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
      return socket.emit('error_message', 'Otaq tapılmadı! Zəhmət olmasa kodu yoxlayın.');
    }

    if (room.gameState !== 'LOBBY') {
      return socket.emit('error_message', 'Bu otaqda oyun artıq başlayıb!');
    }

    currentRoomCode = code;
    socket.join(code);

    const isHost = room.players.size === 0;
    if (isHost) room.hostId = socket.id;

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName || `Oyunçu ${room.players.size + 1}`,
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

  // In-Room Chat Message
  socket.on('send_room_chat', ({ message }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const sender = room.players.get(socket.id);
    if (!sender || !sender.room) return;

    const text = (message || '').trim();
    if (!text) return;

    const msgPayload = {
      senderId: sender.id,
      senderName: sender.name,
      room: sender.room,
      text: text.substring(0, 300),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Broadcast only to current players in that room
    room.players.forEach(p => {
      if (p.room === sender.room) {
        io.to(p.id).emit('new_room_chat', msgPayload);
      }
    });
  });

  // Update Settings
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

  // Start Game
  socket.on('start_game', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.hostId !== socket.id || room.gameState !== 'LOBBY') return;

    const playerCount = room.players.size;
    if (playerCount < 4) {
      return socket.emit('error_message', 'Oyunu başlamaq üçün ən azı 4 oyunçu lazımdır (tövsiyə olunur: 6-12)!');
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
    room.roomA.lockedIn = false;
    room.roomB.lockedIn = false;

    startRoundTimer(room);
    broadcastRoomState(currentRoomCode);

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

    recalculateLeader(room, voter.room);
    broadcastRoomState(currentRoomCode);
  });

  // Select Hostages
  socket.on('select_hostages', ({ hostageIds }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const player = room.players.get(socket.id);
    if (!player || !player.isLeader) return;

    const roomData = player.room === 'A' ? room.roomA : room.roomB;
    const maxHostages = room.settings.hostagesPerRound[room.currentRound - 1] || 1;

    const valid = hostageIds.filter(id => {
      const target = room.players.get(id);
      return target && target.room === player.room && id !== socket.id;
    }).slice(0, maxHostages);

    roomData.selectedHostages = valid;
    broadcastRoomState(currentRoomCode);
  });

  // Lock Hostages
  socket.on('lock_hostages', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const player = room.players.get(socket.id);
    if (!player || !player.isLeader) return;

    const roomData = player.room === 'A' ? room.roomA : room.roomB;
    const maxHostages = room.settings.hostagesPerRound[room.currentRound - 1] || 1;
    
    // Only lock if they have the exact number of hostages, or if there aren't enough eligible players
    const eligibleCount = Array.from(room.players.values()).filter(p => p.room === player.room && p.id !== player.id).length;
    if (roomData.selectedHostages.length === Math.min(maxHostages, eligibleCount)) {
      roomData.lockedIn = true;
      
      // If BOTH are locked in, slash timer to 5 seconds
      if (room.roomA.lockedIn && room.roomB.lockedIn) {
        if (room.roundTimeRemaining > 5) {
          room.roundTimeRemaining = 5;
        }
      }
      broadcastRoomState(currentRoomCode);
    }
  });

  // Share Request
  socket.on('request_share', ({ targetIds, type }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const sender = room.players.get(socket.id);
    if (!sender) return;

    if (sender.role && sender.role.isShy) {
      return socket.emit('error_message', 'Siz Utancaqsınız! Kartınızı və ya rənginizi göstərmək qadağandır!');
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
        type
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

    if (target.role && target.role.isShy) {
      io.to(sender.id).emit('error_message', `${target.name} Utancaqdır! O kartını göstərə bilməz.`);
      socket.emit('error_message', 'Siz Utancaqsınız! Kartınızı göstərmək qadağandır.');
      return;
    }

    if (shareReq.type === 'color') {
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

  // Agent Interrogation
  socket.on('agent_interrogate', ({ targetId }) => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;

    const agent = room.players.get(socket.id);
    const target = room.players.get(targetId);

    if (!agent || !agent.role || !agent.role.isAgent) {
      return socket.emit('error_message', 'Sizin Agent səlahiyyətiniz yoxdur!');
    }

    if (agent.agentUsedThisRound) {
      return socket.emit('error_message', 'Siz bu raundda Agent qabiliyyətini artıq istifadə etmisiniz!');
    }

    if (!target || target.room !== agent.room) {
      return socket.emit('error_message', 'Hədəf sizin otağınızda olmalıdır!');
    }

    agent.agentUsedThisRound = true;

    if (target.role && target.role.isShy) {
      socket.emit('agent_result', {
        targetName: target.name,
        success: false,
        message: `${target.name} Utancaq çıxdı! Onun kartını görmək qeyri-mümkündür.`
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

  // Restart Game
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

  // WebRTC Signaling
  socket.on('join_voice_chat', () => {
    const room = rooms.get(currentRoomCode);
    if (!room || room.gameState !== 'PLAYING') return;
    const sender = room.players.get(socket.id);
    if (!sender || !sender.room) return;
    sender.inVoiceChat = true;

    // Tell everyone else in this room that I joined, so they can send me an offer if they are also in voice
    room.players.forEach(p => {
      if (p.id !== socket.id && p.room === sender.room && p.inVoiceChat) {
        io.to(p.id).emit('peer_joined_voice', { peerId: socket.id });
      }
    });
  });

  socket.on('leave_voice_chat', () => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const sender = room.players.get(socket.id);
    if (sender) sender.inVoiceChat = false;

    // Tell others to close my connection
    room.players.forEach(p => {
      if (p.id !== socket.id && p.room === sender.room) {
        io.to(p.id).emit('peer_left_voice', { peerId: socket.id });
      }
    });
  });

  socket.on('webrtc_signal', ({ targetId, signal }) => {
    const room = rooms.get(currentRoomCode);
    if (!room) return;
    const sender = room.players.get(socket.id);
    const target = room.players.get(targetId);
    
    // Only route signals if they are in the same room (A or B)
    if (sender && target && sender.room === target.room) {
      io.to(targetId).emit('webrtc_signal', {
        senderId: socket.id,
        signal
      });
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

  const presRole = {
    roleId: 'president',
    name: 'Prezident',
    team: 'blue',
    apparentColor: 'blue',
    desc: 'Mavilərin əsas lideri! 3-cü raundun sonunda Bombist OLMAYAN otaqda olmalısınız.'
  };

  const bomberRole = {
    roleId: 'bomber',
    name: 'Bombist',
    team: 'red',
    apparentColor: 'red',
    desc: 'Qırmızıların əsas oyunçusu! 3-cü raundun sonunda Prezidentlə EYNİ OTAQDA olmalısınız ki, partlayış baş versin.'
  };

  const presPlayerId = roomAPlayers[0];
  const bomberPlayerId = roomBPlayers[0];

  room.players.get(presPlayerId).role = presRole;
  room.players.get(bomberPlayerId).role = bomberRole;

  const remainingPlayers = shuffle([
    ...roomAPlayers.slice(1),
    ...roomBPlayers.slice(1)
  ]);

  const adv = room.settings.advancedRoles;
  const rolesList = [];

  // Spies
  if (adv.spies && remainingPlayers.length >= 2) {
    rolesList.push({
      roleId: 'red_spy',
      name: 'Qırmızı Casus',
      team: 'red',
      apparentColor: 'blue',
      desc: 'Siz Qırmızı komandadasınız, lakin Rəng Göstərəndə rənginiz MAVİ parıldayır! Maviləri aldadın və Prezidentin yerini öyrənin.'
    });
    rolesList.push({
      roleId: 'blue_spy',
      name: 'Mavi Casus',
      team: 'blue',
      apparentColor: 'red',
      desc: 'Siz Mavi komandadasınız, lakin Rəng Göstərəndə rənginiz QIRMIZI parıldayır! Qırmızıların planını pozun.'
    });
  }

  // Shy Guy & Agent
  if (adv.shyGuy && adv.agent && remainingPlayers.length >= (rolesList.length + 2)) {
    rolesList.push({
      roleId: 'shy_guy',
      name: 'Utancaq',
      team: 'blue',
      apparentColor: 'blue',
      isShy: true,
      desc: 'Sizə kartınızı və ya rənginizi göstərmək QƏTİ QADAĞANDIR! Düymələr bloklanıb. Digər oyunçular da özlərini Utancaq kimi qələmə verə bilər.'
    });
    rolesList.push({
      roleId: 'agent',
      name: 'Agent',
      team: 'red',
      apparentColor: 'red',
      isAgent: true,
      desc: 'Hər raundda bir dəfə öz otağınızdakı istənilən oyunçunu məcburi dindirib kartına baxa bilərsiniz (əgər o Utancaq deyilsə).'
    });
  }

  rolesList.forEach(r => {
    if (remainingPlayers.length > 0) {
      const pid = remainingPlayers.pop();
      room.players.get(pid).role = r;
    }
  });

  let blueCount = Array.from(room.players.values()).filter(p => p.role && p.role.team === 'blue').length;
  let redCount = Array.from(room.players.values()).filter(p => p.role && p.role.team === 'red').length;

  while (remainingPlayers.length > 0) {
    const pid = remainingPlayers.pop();
    if (blueCount <= redCount) {
      room.players.get(pid).role = {
        roleId: 'blue_guard',
        name: 'Mühafizəçi',
        team: 'blue',
        apparentColor: 'blue',
        desc: 'Mavi komandanın döyüşçüsü. Prezidenti qoruyun və casusları aşkar edin.'
      };
      blueCount++;
    } else {
      room.players.get(pid).role = {
        roleId: 'red_terrorist',
        name: 'Terrorçu',
        team: 'red',
        apparentColor: 'red',
        desc: 'Qırmızı komandanın döyüşçüsü. Bombistə Prezidenti tapmaqda kömək edin.'
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

  exchangeHostages(room);

  if (currentR >= maxRounds) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
    room.gameState = 'ENDED';

    let presRoom = null;
    let bomberRoom = null;

    room.players.forEach(p => {
      if (p.role && p.role.roleId === 'president') presRoom = p.room;
      if (p.role && p.role.roleId === 'bomber') bomberRoom = p.room;
    });

    const isBoom = (presRoom === bomberRoom);

    room.gameResult = {
      winner: isBoom ? 'red' : 'blue',
      title: isBoom ? '💥 BUM! QIRMIZILAR QALİB GƏLDİ!' : '🛡️ PREZİDENT XİLAS EDİLDİ! MAVİLƏR QALİB GƏLDİ!',
      message: isBoom
        ? `Bombist və Prezident Otaq ${presRoom}-də bir araya gəldi! Güclü partlayış baş verdi.`
        : `Prezident Otaq ${presRoom}-də, Bombist isə Otaq ${bomberRoom}-də idi. Bomba boş otaqda partladı!`,
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
    room.currentRound++;
    room.roundTimeRemaining = room.settings.roundTimes[room.currentRound - 1] || 60;

    room.players.forEach(p => {
      p.agentUsedThisRound = false;
    });
    room.roomA.selectedHostages = [];
    room.roomB.selectedHostages = [];
    room.roomA.lockedIn = false;
    room.roomB.lockedIn = false;

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

  const leavingA_names = hostagesA.map(id => room.players.get(id)?.name || 'Oyunçu');
  const leavingB_names = hostagesB.map(id => room.players.get(id)?.name || 'Oyunçu');

  // Move A to B: clear their chat history so they start fresh in Room B!
  hostagesA.forEach(id => {
    const p = room.players.get(id);
    if (p) {
      p.room = 'B';
      if (p.inVoiceChat) {
        p.inVoiceChat = false; // Force re-join or turn off
        io.to(id).emit('force_leave_voice');
      }
      io.to(id).emit('room_changed_clear_chat', { newRoom: 'B' });
    }
  });

  // Move B to A: clear their chat history so they start fresh in Room A!
  hostagesB.forEach(id => {
    const p = room.players.get(id);
    if (p) {
      p.room = 'A';
      if (p.inVoiceChat) {
        p.inVoiceChat = false;
        io.to(id).emit('force_leave_voice');
      }
      io.to(id).emit('room_changed_clear_chat', { newRoom: 'A' });
    }
  });

  room.roomA.selectedHostages = [];
  room.roomB.selectedHostages = [];
  room.roomA.votes = {};
  room.roomB.votes = {};
  recalculateLeader(room, 'A');
  recalculateLeader(room, 'B');

  const swappedData = {
    fromAtoB: leavingA_names,
    fromBtoA: leavingB_names
  };

  io.to(room.code).emit('hostages_swapped', swappedData);

  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Targeted chat notifications for players remaining in Room A:
  // "İlham digər otağa göndərildi" and "Əli otağa daxil oldu"
  room.players.forEach(p => {
    if (p.room === 'A' && !hostagesB.includes(p.id)) {
      if (leavingA_names.length > 0) {
        io.to(p.id).emit('new_room_chat', {
          senderId: 'system',
          senderName: 'SİSTEM',
          room: 'A',
          text: `📤 ${leavingA_names.join(', ')} digər otağa göndərildi.`,
          time: nowTime
        });
      }
      if (leavingB_names.length > 0) {
        io.to(p.id).emit('new_room_chat', {
          senderId: 'system',
          senderName: 'SİSTEM',
          room: 'A',
          text: `🚪 ${leavingB_names.join(', ')} otağa daxil oldu.`,
          time: nowTime
        });
      }
    }

    // Targeted chat notifications for players remaining in Room B:
    if (p.room === 'B' && !hostagesA.includes(p.id)) {
      if (leavingB_names.length > 0) {
        io.to(p.id).emit('new_room_chat', {
          senderId: 'system',
          senderName: 'SİSTEM',
          room: 'B',
          text: `📤 ${leavingB_names.join(', ')} digər otağa göndərildi.`,
          time: nowTime
        });
      }
      if (leavingA_names.length > 0) {
        io.to(p.id).emit('new_room_chat', {
          senderId: 'system',
          senderName: 'SİSTEM',
          room: 'B',
          text: `🚪 ${leavingA_names.join(', ')} otağa daxil oldu.`,
          time: nowTime
        });
      }
    }
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
      lockedIn: room.roomA.lockedIn,
      playerCount: publicPlayers.filter(p => p.room === 'A').length
    },
    roomB: {
      leaderId: room.roomB.leaderId,
      selectedHostages: room.roomB.selectedHostages,
      lockedIn: room.roomB.lockedIn,
      playerCount: publicPlayers.filter(p => p.room === 'B').length
    },
    gameResult: room.gameResult
  };

  io.to(roomCode).emit('room_state_update', state);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BoomRoom: Two Rooms & a Boom running on http://localhost:${PORT}`);
});
