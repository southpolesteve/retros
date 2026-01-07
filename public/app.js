// State
let ws = null;
const state = {
  visitorId: null,
  visitorName: null,
  retro: null,
  participants: [],
  items: [],
  votesRemaining: 3,
  isFacilitator: false,
};

// Get retro ID from URL
const retroId = window.location.pathname.split('/').pop();

// Storage key for this specific retro
const storageKey = `retro_${retroId}`;

// DOM Elements
const joinModal = document.getElementById('joinModal');
const joinModalTitle = document.getElementById('joinModalTitle');
const joinModalSubtitle = document.getElementById('joinModalSubtitle');
const retroNameDisplay = document.getElementById('retroNameDisplay');
const mainContent = document.getElementById('mainContent');
const retroNameInput = document.getElementById('retroNameInput');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const retroNameEl = document.getElementById('retroName');
const phaseLabel = document.getElementById('phaseLabel');
const participantsEl = document.getElementById('participants');
const votesRemainingEl = document.getElementById('votesRemaining');
const votesCountEl = document.getElementById('votesCount');
const facilitatorControls = document.getElementById('facilitatorControls');
const nextPhaseBtn = document.getElementById('nextPhaseBtn');
const deleteRetroBtn = document.getElementById('deleteRetroBtn');
const shareLink = document.getElementById('shareLink');

// Initialize
async function init() {
  // Set share link
  shareLink.textContent = window.location.href;

  // Event listeners
  joinBtn.addEventListener('click', handleJoin);
  nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleJoin();
  });
  retroNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') nameInput.focus();
  });
  nextPhaseBtn.addEventListener('click', handleNextPhase);
  deleteRetroBtn.addEventListener('click', handleDeleteRetro);

  // Check if we have saved credentials for this retro URL
  const saved = getSavedSession();
  if (saved) {
    // Auto-reconnect with saved name
    connect(saved.visitorName);
    return;
  }

  // Check if retro already exists
  const retroInfo = await checkRetroExists();

  if (retroInfo.exists) {
    // Existing retro - show its name, don't show name input
    joinModalTitle.textContent = retroInfo.name;
    joinModalSubtitle.textContent = 'Enter your name to join';
    retroNameDisplay.classList.add('hidden');
    retroNameInput.classList.add('hidden');
  } else {
    // New retro - show input for retro name
    joinModalTitle.textContent = 'Create Retro';
    joinModalSubtitle.textContent =
      'Name your retro and enter your name to start';
    retroNameInput.classList.remove('hidden');
    retroNameInput.focus();
  }

  joinModal.classList.remove('hidden');
}

async function checkRetroExists() {
  try {
    const response = await fetch(`/api/retro/${retroId}`);
    return await response.json();
  } catch (_e) {
    return { exists: false };
  }
}

function getSavedSession() {
  try {
    const data = localStorage.getItem(storageKey);
    if (data) {
      return JSON.parse(data);
    }
  } catch (_e) {}
  return null;
}

function saveSession(visitorName) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ visitorName }));
  } catch (_e) {}
}

function clearSession() {
  try {
    localStorage.removeItem(storageKey);
  } catch (_e) {}
}

function handleJoin() {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  const retroName = retroNameInput.classList.contains('hidden')
    ? null
    : retroNameInput.value.trim();
  connect(name, retroName);
}

function connect(name, retroName = null) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/retro/${retroId}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    const joinMsg = { type: 'join', name };
    if (retroName) joinMsg.retroName = retroName;
    ws.send(JSON.stringify(joinMsg));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleMessage(message);
  };

  ws.onclose = () => {
    // Could add reconnection logic here if needed
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function handleMessage(message) {
  switch (message.type) {
    case 'state':
      handleState(message);
      break;
    case 'participant-joined':
      handleParticipantJoined(message.participant);
      break;
    case 'participant-left':
      handleParticipantLeft(message.visitorId);
      break;
    case 'item-added':
      handleItemAdded(message.item);
      break;
    case 'vote-updated':
      handleVoteUpdated(message);
      break;
    case 'phase-changed':
      handlePhaseChanged(message.phase, message.items);
      break;
    case 'retro-name-updated':
      handleRetroNameUpdated(message.name);
      break;
    case 'retro-deleted':
      clearSession();
      alert('This retro has been deleted.');
      window.location.href = '/';
      break;
    case 'error':
      console.error('Server error:', message.message);
      alert(message.message);
      break;
  }
}

function handleState(message) {
  state.visitorId = message.visitorId;
  state.retro = message.retro;
  state.participants = message.participants;
  state.items = message.items;
  state.votesRemaining = message.votesRemaining;
  state.isFacilitator = message.retro.facilitatorId === message.visitorId;

  // Find my name from participants
  const me = state.participants.find((p) => p.id === state.visitorId);
  if (me) {
    state.visitorName = me.name;
    // Save session for reconnect on refresh
    saveSession(me.name);
  }

  // Show main content
  joinModal.classList.add('hidden');
  mainContent.classList.remove('hidden');

  // Update UI
  updateRetroName();
  updatePhase();
  updateParticipants();
  updateItems();
  updateFacilitatorControls();
}

function handleParticipantJoined(participant) {
  const existing = state.participants.find((p) => p.id === participant.id);
  if (existing) {
    existing.isConnected = true;
    existing.name = participant.name;
  } else {
    state.participants.push(participant);
  }
  updateParticipants();
}

function handleParticipantLeft(visitorId) {
  const participant = state.participants.find((p) => p.id === visitorId);
  if (participant) {
    participant.isConnected = false;
  }
  updateParticipants();
}

function handleItemAdded(item) {
  state.items.push(item);
  if (state.retro.phase !== 'adding') {
    renderItem(item);
  }
  updateItemCounts();
}

function handleVoteUpdated(message) {
  const item = state.items.find((i) => i.id === message.itemId);
  if (item) {
    item.votes = message.votes;
    item.votedByMe = message.votedByMe;
  }
  state.votesRemaining = message.votesRemaining;
  updateVotesRemaining();
  updateItemVoteUI(message.itemId);
}

function handlePhaseChanged(phase, items) {
  state.retro.phase = phase;
  if (items) {
    state.items = items;
    updateItems();
  }
  updatePhase();
  updateFacilitatorControls();
}

function handleRetroNameUpdated(name) {
  state.retro.name = name;
  updateRetroName();
}

// UI Updates
function updateRetroName() {
  const name = state.retro?.name || 'Retro';
  retroNameEl.textContent = name;
  document.title = `${name} - Retro`;

  if (state.isFacilitator) {
    retroNameEl.classList.add('editable');
    retroNameEl.onclick = startEditingRetroName;
  } else {
    retroNameEl.classList.remove('editable');
    retroNameEl.onclick = null;
  }
}

function startEditingRetroName() {
  if (!state.isFacilitator) return;

  const currentName = state.retro.name;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentName;
  input.className = 'retro-name-input';
  input.maxLength = 100;

  input.onblur = () => finishEditingRetroName(input);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditingRetroName(input);
    } else if (e.key === 'Escape') {
      input.value = currentName;
      finishEditingRetroName(input);
    }
  };

  retroNameEl.textContent = '';
  retroNameEl.appendChild(input);
  input.focus();
  input.select();
}

function finishEditingRetroName(input) {
  const newName = input.value.trim() || 'Untitled Retro';
  if (newName !== state.retro.name) {
    ws.send(JSON.stringify({ type: 'update-retro-name', name: newName }));
  }
  retroNameEl.textContent = state.retro.name;
}

function updatePhase() {
  const phase = state.retro.phase;
  phaseLabel.textContent = phase.charAt(0).toUpperCase() + phase.slice(1);
  phaseLabel.className = `phase-badge phase-${phase}`;

  for (const el of document.querySelectorAll('.phase-message')) {
    el.classList.add('hidden');
  }
  document.getElementById(`${phase}Message`)?.classList.remove('hidden');

  document.querySelectorAll('.add-item').forEach((el) => {
    if (phase === 'adding') {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  if (phase === 'voting') {
    votesRemainingEl.classList.remove('hidden');
    updateVotesRemaining();
  } else {
    votesRemainingEl.classList.add('hidden');
  }

  if (phase === 'voting' || phase === 'discussion' || phase === 'complete') {
    updateItems();
  }
}

function updateParticipants() {
  const connected = state.participants.filter((p) => p.isConnected);
  participantsEl.innerHTML = connected
    .map(
      (p) => `
    <span class="participant ${p.isFacilitator ? 'facilitator' : ''}">
      ${escapeHtml(p.name)}${p.isFacilitator ? ' (Facilitator)' : ''}
    </span>
  `,
    )
    .join('');
}

function updateVotesRemaining() {
  votesCountEl.textContent = state.votesRemaining;
}

function updateItems() {
  document.getElementById('startItems').innerHTML = '';
  document.getElementById('stopItems').innerHTML = '';
  document.getElementById('continueItems').innerHTML = '';

  const phase = state.retro.phase;

  if (phase === 'adding' || phase === 'waiting') {
    updateItemCounts();
    return;
  }

  const items = [...state.items];
  if (phase === 'discussion' || phase === 'complete') {
    items.sort((a, b) => b.votes - a.votes);
  }

  for (const item of items) {
    renderItem(item);
  }
}

function updateItemCounts() {
  const phase = state.retro.phase;
  if (phase !== 'adding') return;

  const counts = {
    start: state.items.filter((i) => i.column === 'start').length,
    stop: state.items.filter((i) => i.column === 'stop').length,
    continue: state.items.filter((i) => i.column === 'continue').length,
  };

  ['start', 'stop', 'continue'].forEach((column) => {
    const container = document.getElementById(`${column}Items`);
    if (counts[column] > 0) {
      container.innerHTML = `<div class="item-count">${counts[column]} item${counts[column] !== 1 ? 's' : ''} added</div>`;
    }
  });
}

function renderItem(item) {
  const container = document.getElementById(`${item.column}Items`);
  const phase = state.retro.phase;

  const itemEl = document.createElement('div');
  itemEl.className = 'item';
  itemEl.id = `item-${item.id}`;

  const showVotes = phase === 'discussion' || phase === 'complete';
  const canVote = phase === 'voting';

  itemEl.innerHTML = `
    <div class="item-text">${escapeHtml(item.text)}</div>
    ${showVotes ? `<div class="item-votes">${item.votes} vote${item.votes !== 1 ? 's' : ''}</div>` : ''}
    ${
      canVote
        ? `
      <div class="item-vote-controls">
        <button class="btn btn-vote ${item.votedByMe ? 'voted' : ''}" onclick="toggleVote('${item.id}')">
          ${item.votedByMe ? 'Voted' : 'Vote'}
        </button>
      </div>
    `
        : ''
    }
  `;

  container.appendChild(itemEl);
}

function updateItemVoteUI(itemId) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  const itemEl = document.getElementById(`item-${itemId}`);
  if (!itemEl) return;

  const voteBtn = itemEl.querySelector('.btn-vote');
  if (voteBtn) {
    voteBtn.className = `btn btn-vote ${item.votedByMe ? 'voted' : ''}`;
    voteBtn.textContent = item.votedByMe ? 'Voted' : 'Vote';
  }
}

function updateFacilitatorControls() {
  if (!state.isFacilitator) {
    facilitatorControls.classList.add('hidden');
    return;
  }

  facilitatorControls.classList.remove('hidden');

  const phase = state.retro.phase;

  const nextPhases = {
    waiting: { next: 'adding', label: 'Start Adding Items' },
    adding: { next: 'voting', label: 'Start Voting' },
    voting: { next: 'discussion', label: 'End Voting & Discuss' },
    discussion: { next: 'complete', label: 'Complete Retro' },
    complete: null,
  };

  const prevPhases = {
    waiting: null,
    adding: { prev: 'waiting', label: 'Back to Waiting' },
    voting: { prev: 'adding', label: 'Back to Adding' },
    discussion: { prev: 'voting', label: 'Back to Voting' },
    complete: null,
  };

  const nextPhase = nextPhases[phase];
  if (nextPhase) {
    nextPhaseBtn.classList.remove('hidden');
    nextPhaseBtn.textContent = nextPhase.label;
    nextPhaseBtn.dataset.nextPhase = nextPhase.next;
  } else {
    nextPhaseBtn.classList.add('hidden');
  }

  let prevPhaseBtn = document.getElementById('prevPhaseBtn');
  const prevPhase = prevPhases[phase];

  if (prevPhase) {
    if (!prevPhaseBtn) {
      prevPhaseBtn = document.createElement('button');
      prevPhaseBtn.id = 'prevPhaseBtn';
      prevPhaseBtn.className = 'btn btn-secondary';
      prevPhaseBtn.addEventListener('click', handlePrevPhase);
      facilitatorControls.insertBefore(prevPhaseBtn, nextPhaseBtn);
    }
    prevPhaseBtn.textContent = prevPhase.label;
    prevPhaseBtn.dataset.prevPhase = prevPhase.prev;
    prevPhaseBtn.classList.remove('hidden');
  } else if (prevPhaseBtn) {
    prevPhaseBtn.classList.add('hidden');
  }
}

// Actions
function addItem(column) {
  const input = document.getElementById(`${column}Input`);
  const text = input.value.trim();
  if (!text) return;

  ws.send(JSON.stringify({ type: 'add-item', column, text }));
  input.value = '';
}

function toggleVote(itemId) {
  const item = state.items.find((i) => i.id === itemId);
  if (!item) return;

  if (item.votedByMe) {
    ws.send(JSON.stringify({ type: 'unvote', itemId }));
  } else {
    if (state.votesRemaining <= 0) {
      alert('No votes remaining! Remove a vote from another item first.');
      return;
    }
    ws.send(JSON.stringify({ type: 'vote', itemId }));
  }
}

function handleNextPhase() {
  const nextPhase = nextPhaseBtn.dataset.nextPhase;
  if (nextPhase) {
    ws.send(JSON.stringify({ type: 'set-phase', phase: nextPhase }));
  }
}

function handlePrevPhase() {
  const prevPhaseBtn = document.getElementById('prevPhaseBtn');
  const prevPhase = prevPhaseBtn?.dataset.prevPhase;
  if (prevPhase) {
    ws.send(JSON.stringify({ type: 'set-phase', phase: prevPhase }));
  }
}

function handleDeleteRetro() {
  if (
    confirm(
      'Are you sure you want to delete this retro? This cannot be undone.',
    )
  ) {
    ws.send(JSON.stringify({ type: 'delete-retro' }));
  }
}

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions available globally for onclick handlers
window.addItem = addItem;
window.toggleVote = toggleVote;

// Setup Enter key handling for add item textareas
function setupTextareaHandlers() {
  ['start', 'stop', 'continue'].forEach((column) => {
    const textarea = document.getElementById(`${column}Input`);
    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          addItem(column);
        }
      });
    }
  });
}

// Start
init();
setupTextareaHandlers();
