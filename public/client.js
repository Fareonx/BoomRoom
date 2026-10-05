import * as Sound from './sound.js';

const socket = io();

// State
let myPlayerId = null;
let currentRoomCode = null;
let isHost = false;
let myRole = null;
let myRoom = null;
let roomState = null;
let selectedTargetIds = new Set();
let pendingIncomingReqId = null;
let isChatOpen = false;

// DOM Elements
const screenAuth = document.getElementById('screen-auth');
const screenLobby = document.getElementById('screen-lobby');
const screenGame = document.getElementById('screen-game');
const screenGameOver = document.getElementById('screen-game-over');

const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const btnJoinRoom = document.getElementById('btn-join-room');
const btnCreateRoom = document.getElementById('btn-create-room');

const lobbyRoomCode = document.getElementById('lobby-room-code');
const lobbyPlayerList = document.getElementById('lobby-player-list');
const playerCountEl = document.getElementById('player-count');
const hostSettingsPanel = document.getElementById('host-settings');
const btnStartGame = document.getElementById('btn-start-game');
const waitingForHostMsg = document.getElementById('waiting-for-host-msg');

const settingRounds = document.getElementById('setting-rounds');
const roleToggleSpies = document.getElementById('role-toggle-spies');
const roleToggleSpecial = document.getElementById('role-toggle-special');

const hudRound = document.getElementById('hud-round');
const hudTimer = document.getElementById('hud-timer');
const hudRoom = document.getElementById('hud-room');

const secretCard = document.getElementById('secret-card');
const cardTeamBadge = document.getElementById('card-team-badge');
const cardRoleName = document.getElementById('card-role-name');
const cardRoleDesc = document.getElementById('card-role-desc');
const cardApparentNote = document.getElementById('card-apparent-note');

const roomPlayersList = document.getElementById('room-players-list');
const roomMemberCount = document.getElementById('room-member-count');
const youAreLeaderBadge = document.getElementById('you-are-leader-badge');
const shyWarning = document.getElementById('shy-warning');

const btnShareColor = document.getElementById('btn-share-color');
const btnShareCard = document.getElementById('btn-share-card');
const btnAgentPower = document.getElementById('btn-agent-power');

const leaderPanel = document.getElementById('leader-panel');
const hostagesNeededCount = document.getElementById('hostages-needed-count');
const leaderHostageSelection = document.getElementById('leader-hostage-selection');

const gameOverTitle = document.getElementById('game-over-title');
const gameOverIcon = document.getElementById('game-over-icon');
const gameOverMessage = document.getElementById('game-over-message');
const debriefList = document.getElementById('debrief-list');
const btnRestartLobby = document.getElementById('btn-restart-lobby');

// Modals
const modalIncomingShare = document.getElementById('modal-incoming-share');
const shareModalIcon = document.getElementById('share-modal-icon');
const shareModalTitle = document.getElementById('share-modal-title');
const shareModalDesc = document.getElementById('share-modal-desc');
const btnAcceptShare = document.getElementById('btn-accept-share');
const btnDeclineShare = document.getElementById('btn-decline-share');

const modalCardReveal = document.getElementById('modal-card-reveal');
const revealedPlayerName = document.getElementById('revealed-player-name');
const revealedRoleBadge = document.getElementById('revealed-role-badge');
const revealedRoleTitle = document.getElementById('revealed-role-title');
const revealedRoleDesc = document.getElementById('revealed-role-desc');
const btnCloseCardReveal = document.getElementById('btn-close-card-reveal');

const overlayColorFlash = document.getElementById('overlay-color-flash');
const flashColorName = document.getElementById('flash-color-name');
const flashFromPlayer = document.getElementById('flash-from-player');
const toastEl = document.getElementById('toast');

// Chat Elements
const btnToggleChat = document.getElementById('btn-toggle-chat');
const chatUnreadDot = document.getElementById('chat-unread-dot');
const modalRoomChat = document.getElementById('modal-room-chat');
const chatHeaderRoomTitle = document.getElementById('chat-header-room-title');
const chatMessagesContainer = document.getElementById('chat-messages-container');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnCloseChat = document.getElementById('btn-close-chat');

// Auto-fill player name
if (localStorage.getItem('boom_player_name')) {
  playerNameInput.value = localStorage.getItem('boom_player_name');
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  setTimeout(() => {
    toastEl.style.opacity = '0';
  }, 3000);
}

// 1. Join / Create Room
btnCreateRoom.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Komandir';
  localStorage.setItem('boom_player_name', name);
  socket.emit('create_room', { playerName: name });
});

btnJoinRoom.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Oyunçu';
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) return showToast('4 rəqəmli/hərfli otaq kodunu daxil edin!');
  localStorage.setItem('boom_player_name', name);
  socket.emit('join_room', { roomCode: code, playerName: name });
});

// Socket listeners for Auth
socket.on('room_created', (data) => {
  myPlayerId = data.playerId;
  currentRoomCode = data.roomCode;
  isHost = true;
  switchToLobby();
});

socket.on('room_joined', (data) => {
  myPlayerId = data.playerId;
  currentRoomCode = data.roomCode;
  isHost = data.isHost;
  switchToLobby();
});

socket.on('error_message', (msg) => {
  showToast(msg);
});

function switchToLobby() {
  screenAuth.classList.add('hidden');
  screenGame.classList.add('hidden');
  screenGameOver.classList.add('hidden');
  btnToggleChat.classList.add('hidden');
  screenLobby.classList.remove('hidden');

  lobbyRoomCode.textContent = currentRoomCode;

  if (isHost) {
    hostSettingsPanel.classList.remove('hidden');
    btnStartGame.classList.remove('hidden');
    waitingForHostMsg.classList.add('hidden');
  } else {
    hostSettingsPanel.classList.add('hidden');
    btnStartGame.classList.add('hidden');
    waitingForHostMsg.classList.remove('hidden');
  }
}

// Host Settings
function sendHostSettings() {
  if (!isHost) return;
  const rounds = parseInt(settingRounds.value, 10);
  const roundTimes = rounds === 2 ? [180, 60] : rounds === 4 ? [240, 180, 120, 60] : [180, 120, 60];
  const hostagesPerRound = Array(rounds).fill(1);

  socket.emit('update_settings', {
    settings: {
      rounds,
      roundTimes,
      hostagesPerRound,
      advancedRoles: {
        spies: roleToggleSpies.checked,
        shyGuy: roleToggleSpecial.checked,
        agent: roleToggleSpecial.checked
      }
    }
  });
}

settingRounds.addEventListener('change', sendHostSettings);
roleToggleSpies.addEventListener('change', sendHostSettings);
roleToggleSpecial.addEventListener('change', sendHostSettings);

btnStartGame.addEventListener('click', () => {
  socket.emit('start_game');
});

// 2. Secret Role Received
socket.on('your_secret_role', ({ role, room }) => {
  myRole = role;
  myRoom = room;

  secretCard.className = 'secret-role-card';
  secretCard.classList.add(role.team === 'blue' ? 'team-blue' : 'team-red');

  cardTeamBadge.textContent = role.team === 'blue' ? 'MAVİ KOMANDA' : 'QIRMIZI KOMANDA';
  cardTeamBadge.className = `badge ${role.team === 'blue' ? 'badge-blue' : 'badge-red'}`;
  cardRoleName.textContent = role.name;
  cardRoleDesc.textContent = role.desc;

  if (role.roleId === 'red_spy') {
    cardApparentNote.textContent = '🕵️ Rəng Paylaşımında sizin rənginiz MAVİ görünür!';
  } else if (role.roleId === 'blue_spy') {
    cardApparentNote.textContent = '🕵️ Rəng Paylaşımında sizin rənginiz QIRMIZI görünür!';
  } else {
    cardApparentNote.textContent = '';
  }

  if (role.isShy) {
    shyWarning.classList.remove('hidden');
    btnShareColor.disabled = true;
    btnShareCard.disabled = true;
  } else {
    shyWarning.classList.add('hidden');
    btnShareColor.disabled = false;
    btnShareCard.disabled = false;
  }

  if (role.isAgent) {
    btnAgentPower.classList.remove('hidden');
  } else {
    btnAgentPower.classList.add('hidden');
  }

  switchToGame();
});

function switchToGame() {
  screenAuth.classList.add('hidden');
  screenLobby.classList.add('hidden');
  screenGameOver.classList.add('hidden');
  screenGame.classList.remove('hidden');
  btnToggleChat.classList.remove('hidden');

  updateRoomTitle();
}

function updateRoomTitle() {
  hudRoom.textContent = `Otaq ${myRoom}`;
  hudRoom.className = `badge ${myRoom === 'A' ? 'badge-blue' : 'badge-red'}`;
  chatHeaderRoomTitle.textContent = `Otaq ${myRoom} Çatı`;
}

// Touch & Hold Card Reveal
function revealCard() {
  Sound.playCardFlip();
  secretCard.classList.add('revealed');
}

function hideCard() {
  secretCard.classList.remove('revealed');
}

secretCard.addEventListener('mousedown', revealCard);
secretCard.addEventListener('mouseup', hideCard);
secretCard.addEventListener('mouseleave', hideCard);
secretCard.addEventListener('touchstart', (e) => {
  e.preventDefault();
  revealCard();
});
secretCard.addEventListener('touchend', (e) => {
  e.preventDefault();
  hideCard();
});

// 3. Room State Update
socket.on('room_state_update', (state) => {
  roomState = state;

  if (state.gameState === 'LOBBY') {
    playerCountEl.textContent = state.players.length;
    lobbyPlayerList.innerHTML = '';
    state.players.forEach(p => {
      const div = document.createElement('div');
      div.className = 'player-item';
      div.innerHTML = `
        <span><strong>${escapeHtml(p.name)}</strong> ${p.id === myPlayerId ? '<span style="color:#60a5fa;">(Siz)</span>' : ''}</span>
        ${p.isHost ? '<span class="badge badge-gold">Host</span>' : ''}
      `;
      lobbyPlayerList.appendChild(div);
    });

    if (btnStartGame) {
      btnStartGame.disabled = (state.players.length < 4);
      btnStartGame.textContent = state.players.length < 4 
        ? `Ən azı 4 oyunçu lazımdır (${state.players.length}/4)` 
        : 'Oyunu Başlat 🚀';
    }
  }

  if (state.gameState === 'PLAYING') {
    hudRound.textContent = `${state.currentRound} / ${state.settings.rounds}`;

    const me = state.players.find(p => p.id === myPlayerId);
    if (me && me.room) {
      if (myRoom !== me.room) {
        myRoom = me.room;
        updateRoomTitle();
        Sound.playAlert();
        showToast(`Siz Otaq ${myRoom}-yə keçdiniz!`);

        // Add notice to chat
        appendChatMessage({
          senderName: 'SİSTEM',
          text: `Siz Otaq ${myRoom}-yə keçdiniz. İndi bu otaqdakılarla danışırsınız.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }, true);
      }

      if (me.isLeader) {
        youAreLeaderBadge.classList.remove('hidden');
        leaderPanel.classList.remove('hidden');
      } else {
        youAreLeaderBadge.classList.add('hidden');
        leaderPanel.classList.add('hidden');
      }
    }

    renderRoomPlayers(state);
    renderLeaderPanel(state);
  }
});

function renderRoomPlayers(state) {
  const roomMembers = state.players.filter(p => p.room === myRoom);
  roomMemberCount.textContent = roomMembers.length;

  roomPlayersList.innerHTML = '';

  roomMembers.forEach(p => {
    if (p.id === myPlayerId) return;

    const row = document.createElement('div');
    row.className = `selectable-player-row ${selectedTargetIds.has(p.id) ? 'selected' : ''}`;

    const isSelected = selectedTargetIds.has(p.id);
    const me = state.players.find(pl => pl.id === myPlayerId);
    const hasVotedForHim = (me && me.votedFor === p.id);

    row.innerHTML = `
      <div class="player-info-left">
        <input type="checkbox" data-id="${p.id}" ${isSelected ? 'checked' : ''}>
        <span><strong>${escapeHtml(p.name)}</strong> ${p.isLeader ? '👑' : ''}</span>
      </div>
      <div>
        <button class="vote-btn ${hasVotedForHim ? 'voted' : ''}" data-vote-id="${p.id}">
          ${hasVotedForHim ? '✓ Səsiniz' : 'Lider et'}
        </button>
      </div>
    `;

    const checkbox = row.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedTargetIds.add(p.id);
        row.classList.add('selected');
      } else {
        selectedTargetIds.delete(p.id);
        row.classList.remove('selected');
      }
    });

    const voteBtn = row.querySelector('.vote-btn');
    voteBtn.addEventListener('click', () => {
      socket.emit('vote_leader', { candidateId: p.id });
    });

    roomPlayersList.appendChild(row);
  });
}

function renderLeaderPanel(state) {
  const me = state.players.find(p => p.id === myPlayerId);
  if (!me || !me.isLeader) return;

  const currentRound = state.currentRound;
  const maxHostages = state.settings.hostagesPerRound[currentRound - 1] || 1;
  hostagesNeededCount.textContent = maxHostages;

  const roomData = myRoom === 'A' ? state.roomA : state.roomB;
  const currentSelected = roomData.selectedHostages || [];

  const eligibleHostages = state.players.filter(p => p.room === myRoom && p.id !== myPlayerId);

  leaderHostageSelection.innerHTML = '';
  eligibleHostages.forEach(p => {
    const isHostage = currentSelected.includes(p.id);
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';
    label.style.cursor = 'pointer';
    label.style.fontSize = '0.9rem';
    label.innerHTML = `
      <input type="checkbox" value="${p.id}" ${isHostage ? 'checked' : ''} style="width: auto;">
      <span>${escapeHtml(p.name)}</span>
    `;

    const input = label.querySelector('input');
    input.addEventListener('change', () => {
      const selectedBoxes = Array.from(leaderHostageSelection.querySelectorAll('input:checked')).map(i => i.value);
      if (selectedBoxes.length > maxHostages) {
        input.checked = false;
        return showToast(`Maksimum ${maxHostages} girov seçə bilərsiniz!`);
      }
      socket.emit('select_hostages', { hostageIds: selectedBoxes });
    });

    leaderHostageSelection.appendChild(label);
  });
}

// 4. Timer Tick
socket.on('timer_tick', ({ timeRemaining }) => {
  const mins = Math.floor(timeRemaining / 60);
  const secs = timeRemaining % 60;
  hudTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  if (timeRemaining <= 10) {
    hudTimer.classList.add('timer-warning');
    Sound.playTick();
  } else {
    hudTimer.classList.remove('timer-warning');
  }
});

// 5. Hostages Swapped Event
socket.on('hostages_swapped', ({ fromAtoB, fromBtoA }) => {
  Sound.playAlert();
  let msg = `🔄 GİROV DƏYİŞİKLİYİ BAŞ VERDİ!\n`;
  if (fromAtoB.length) msg += `A-dan B-yə: ${fromAtoB.join(', ')}\n`;
  if (fromBtoA.length) msg += `B-dən A-ya: ${fromBtoA.join(', ')}`;
  showToast(msg);
});

// 6. Share Actions
btnShareColor.addEventListener('click', () => {
  if (selectedTargetIds.size === 0) return showToast('Ən azı 1 oyunçunu işarələyin!');
  socket.emit('request_share', {
    targetIds: Array.from(selectedTargetIds),
    type: 'color'
  });
  showToast('Rəng göstərmək təklifi göndərildi!');
});

btnShareCard.addEventListener('click', () => {
  if (selectedTargetIds.size === 0) return showToast('Ən azı 1 oyunçunu işarələyin!');
  socket.emit('request_share', {
    targetIds: Array.from(selectedTargetIds),
    type: 'card'
  });
  showToast('Kart göstərmək təklifi göndərildi!');
});

// Agent Interrogate Power
btnAgentPower.addEventListener('click', () => {
  if (selectedTargetIds.size !== 1) return showToast('Agent dindirməsi üçün yalnız 1 nəfəri seçin!');
  const targetId = Array.from(selectedTargetIds)[0];
  socket.emit('agent_interrogate', { targetId });
});

socket.on('agent_result', ({ targetName, success, message, data }) => {
  if (!success) {
    showToast(message);
  } else {
    revealedPlayerName.textContent = targetName;
    revealedRoleTitle.textContent = data.roleName;
    revealedRoleDesc.textContent = data.desc;
    revealedRoleBadge.textContent = data.team === 'blue' ? 'MAVİ KOMANDA' : 'QIRMIZI KOMANDA';
    revealedRoleBadge.className = `badge ${data.team === 'blue' ? 'badge-blue' : 'badge-red'}`;
    modalCardReveal.classList.remove('hidden');
    Sound.playCardFlip();
  }
});

socket.on('agent_interrogated_you', ({ agentName, blocked }) => {
  Sound.playAlert();
  if (blocked) {
    showToast(`🕵️ Agent ${agentName} sizi dindirmək istədi, lakin siz Utancaqsınız!`);
  } else {
    showToast(`🕵️ Agent ${agentName} məcburi olaraq kartınıza baxdı!`);
  }
});

// 7. Incoming Share Request Modal
socket.on('incoming_share_request', ({ reqId, fromName, type }) => {
  pendingIncomingReqId = reqId;
  Sound.playAlert();

  shareModalTitle.textContent = type === 'color' ? 'Komanda Rəngi Paylaşımı' : 'Tam Kart Paylaşımı';
  shareModalDesc.textContent = `${fromName} sizə qarşılıqlı olaraq ${type === 'color' ? 'komanda rəngini' : 'kart rolunu'} göstərməyi təklif edir. Razısınız?`;
  modalIncomingShare.classList.remove('hidden');
});

btnAcceptShare.addEventListener('click', () => {
  if (pendingIncomingReqId) {
    socket.emit('respond_share_request', { reqId: pendingIncomingReqId, accepted: true });
    modalIncomingShare.classList.add('hidden');
    pendingIncomingReqId = null;
  }
});

btnDeclineShare.addEventListener('click', () => {
  if (pendingIncomingReqId) {
    socket.emit('respond_share_request', { reqId: pendingIncomingReqId, accepted: false });
    modalIncomingShare.classList.add('hidden');
    pendingIncomingReqId = null;
  }
});

socket.on('share_rejected', ({ targetName }) => {
  showToast(`${targetName} təklifi rədd etdi.`);
});

// 8. Share Revealed
socket.on('share_revealed', ({ fromPlayer, type, data }) => {
  if (type === 'color') {
    const isBlue = (data.color === 'blue');
    overlayColorFlash.className = `color-flash-overlay ${isBlue ? 'color-flash-blue' : 'color-flash-red'}`;
    flashColorName.textContent = isBlue ? 'MAVİ' : 'QIRMIZI';
    flashFromPlayer.textContent = `Oyunçunun rəngi: ${fromPlayer}`;
    overlayColorFlash.classList.remove('hidden');
    Sound.playAlert();

    setTimeout(() => {
      overlayColorFlash.classList.add('hidden');
    }, 3000);
  } else if (type === 'card') {
    revealedPlayerName.textContent = fromPlayer;
    revealedRoleTitle.textContent = data.roleName;
    revealedRoleDesc.textContent = data.desc;
    revealedRoleBadge.textContent = data.team === 'blue' ? 'MAVİ KOMANDA' : 'QIRMIZI KOMANDA';
    revealedRoleBadge.className = `badge ${data.team === 'blue' ? 'badge-blue' : 'badge-red'}`;
    modalCardReveal.classList.remove('hidden');
    Sound.playCardFlip();
  }
});

btnCloseCardReveal.addEventListener('click', () => {
  modalCardReveal.classList.add('hidden');
});

// 9. In-Room Chat Handling
socket.on('room_changed_clear_chat', ({ newRoom }) => {
  myRoom = newRoom;
  updateRoomTitle();
  chatMessagesContainer.innerHTML = '';
  appendChatMessage({
    senderName: 'SİSTEM',
    text: `🔄 Siz Otaq ${newRoom}-yə keçdiniz. Əvvəlki otağın söhbətləri gizlilik üçün sıfırlandı.`,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }, true);
  Sound.playAlert();
  showToast(`Siz Otaq ${newRoom}-yə keçdiniz!`);
});

btnToggleChat.addEventListener('click', () => {
  isChatOpen = true;
  modalRoomChat.classList.remove('hidden');
  chatUnreadDot.classList.remove('active');
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
  chatInput.focus();
});

btnCloseChat.addEventListener('click', () => {
  isChatOpen = false;
  modalRoomChat.classList.add('hidden');
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('send_room_chat', { message: text });
  chatInput.value = '';
});

socket.on('new_room_chat', (msg) => {
  const isMine = (msg.senderId === myPlayerId);
  const isSystem = (msg.senderId === 'system');

  appendChatMessage(msg, isSystem, isMine);

  if (!isChatOpen) {
    chatUnreadDot.classList.add('active');
    Sound.playAlert();
  }
});

function appendChatMessage(msg, isSystem = false, isMine = false) {
  const div = document.createElement('div');
  if (isSystem) {
    div.className = 'chat-bubble system';
    div.textContent = msg.text;
  } else {
    div.className = `chat-bubble ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `
      <div class="chat-meta">
        <strong>${isMine ? 'Siz' : escapeHtml(msg.senderName)}</strong>
        <span>${msg.time}</span>
      </div>
      <div>${escapeHtml(msg.text)}</div>
    `;
  }
  chatMessagesContainer.appendChild(div);
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// 10. Game Ended / Debrief
socket.on('game_ended', (result) => {
  screenGame.classList.add('hidden');
  btnToggleChat.classList.add('hidden');
  modalRoomChat.classList.add('hidden');
  screenGameOver.classList.remove('hidden');

  gameOverTitle.textContent = result.title;
  gameOverMessage.textContent = result.message;

  if (result.winner === 'red') {
    gameOverIcon.textContent = '💥';
    Sound.playBoom();
  } else {
    gameOverIcon.textContent = '🛡️';
    Sound.playSafe();
  }

  debriefList.innerHTML = '';
  result.playersDebrief.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td>Otaq ${p.room}</td>
      <td>${escapeHtml(p.role.name)}</td>
      <td><span class="badge ${p.role.team === 'blue' ? 'badge-blue' : 'badge-red'}">${p.role.team === 'blue' ? 'Mavi' : 'Qırmızı'}</span></td>
    `;
    debriefList.appendChild(tr);
  });

  if (isHost) {
    btnRestartLobby.classList.remove('hidden');
  } else {
    btnRestartLobby.classList.add('hidden');
  }
});

btnRestartLobby.addEventListener('click', () => {
  socket.emit('restart_game');
});

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


// --- WEBRTC VOICE CHAT ---
const btnToggleVoice = document.getElementById('btn-toggle-voice');
let micEnabled = false;
let localStream = null;
let peerConnections = {}; // targetId -> RTCPeerConnection

// Container for audio tags
const audioContainer = document.createElement('div');
audioContainer.id = 'audio-container';
audioContainer.style.display = 'none';
document.body.appendChild(audioContainer);

const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

btnToggleVoice.addEventListener('click', async () => {
  if (!micEnabled) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micEnabled = true;
      btnToggleVoice.textContent = '🔊 Səsi Bağla';
      btnToggleVoice.style.background = '#22c55e'; // green
      socket.emit('join_voice_chat');
      showToast('Səsli çat aktivdir!');
    } catch (err) {
      showToast('Mikrofona icazə verilmədi!');
    }
  } else {
    disableVoice();
  }
});

function disableVoice() {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  micEnabled = false;
  btnToggleVoice.textContent = '🎤 Səsi Aç';
  btnToggleVoice.style.background = '#334155';
  
  // Close all peer connections
  Object.values(peerConnections).forEach(pc => pc.close());
  peerConnections = {};
  audioContainer.innerHTML = ''; // clear audio elements
  
  socket.emit('leave_voice_chat');
}

// When a new person joins voice chat in our room
socket.on('peer_joined_voice', async ({ peerId }) => {
  if (!micEnabled) return;
  // Create offer
  const pc = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  socket.emit('webrtc_signal', {
    targetId: peerId,
    signal: { type: 'offer', offer }
  });
});

socket.on('peer_left_voice', ({ peerId }) => {
  if (peerConnections[peerId]) {
    peerConnections[peerId].close();
    delete peerConnections[peerId];
    const audioEl = document.getElementById(`audio-${peerId}`);
    if (audioEl) audioEl.remove();
  }
});

socket.on('force_leave_voice', () => {
  if (micEnabled) {
    disableVoice();
    showToast('Otaq dəyişdiyi üçün səsli çat dayandırıldı. Yenidən qoşula bilərsiniz.');
  }
});

socket.on('webrtc_signal', async ({ senderId, signal }) => {
  if (!micEnabled) return;

  let pc = peerConnections[senderId];
  if (!pc) {
    pc = createPeerConnection(senderId);
  }

  if (signal.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc_signal', {
      targetId: senderId,
      signal: { type: 'answer', answer }
    });
  } else if (signal.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.answer));
  } else if (signal.type === 'candidate') {
    await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
  }
});

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection(rtcConfig);
  peerConnections[peerId] = pc;

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc_signal', {
        targetId: peerId,
        signal: { type: 'candidate', candidate: event.candidate }
      });
    }
  };

  pc.ontrack = (event) => {
    let audioEl = document.getElementById(`audio-${peerId}`);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = `audio-${peerId}`;
      audioEl.autoplay = true;
      audioContainer.appendChild(audioEl);
    }
    audioEl.srcObject = event.streams[0];
  };

  return pc;
}
