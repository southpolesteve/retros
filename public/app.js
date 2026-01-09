// State
let ws = null;
const state = {
  visitorId: null,
  visitorName: null,
  retro: null,
  participants: [],
  items: [],
  groups: [],
  votesRemaining: 3,
  isFacilitator: false,
  typingActivity: { start: 0, stop: 0, continue: 0 },
};

// Drag and drop state
let draggedItemId = null;

// Typing state - track what we're currently typing in
let currentlyTypingIn = null;
let typingTimeout = null;

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
  if (saved?.visitorId) {
    // Auto-reconnect with saved visitorId and name
    connect(saved.visitorName, saved.visitorId);
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

function saveSession(visitorId, visitorName) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ visitorId, visitorName }),
    );
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
  // New join - no existing visitorId
  connect(name, null, retroName);
}

function connect(name, visitorId = null, retroName = null) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/retro/${retroId}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    const joinMsg = { type: 'join', name };
    if (visitorId) joinMsg.visitorId = visitorId;
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
      handlePhaseChanged(message.phase, message.items, message.groups);
      break;
    case 'retro-name-updated':
      handleRetroNameUpdated(message.name);
      break;
    case 'items-grouped':
      handleItemsGrouped(message.group);
      break;
    case 'items-ungrouped':
      handleItemsUngrouped(message.groupId, message.items);
      break;
    case 'group-title-updated':
      handleGroupTitleUpdated(message.groupId, message.title);
      break;
    case 'typing-activity':
      handleTypingActivity(message.activity);
      break;
    case 'group-vote-updated':
      handleGroupVoteUpdated(message);
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
  state.groups = message.groups || [];
  state.votesRemaining = message.votesRemaining;
  state.isFacilitator = message.retro.facilitatorId === message.visitorId;

  // Find my name from participants
  const me = state.participants.find((p) => p.id === state.visitorId);
  if (me) {
    state.visitorName = me.name;
    // Save session for reconnect on refresh (include visitorId to preserve facilitator status)
    saveSession(state.visitorId, me.name);
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

function handleGroupVoteUpdated(message) {
  const group = state.groups.find((g) => g.id === message.groupId);
  if (group) {
    group.votes = message.votes;
    group.votedByMe = message.votedByMe;
  }
  state.votesRemaining = message.votesRemaining;
  updateVotesRemaining();
  updateGroupVoteUI(message.groupId);
}

function handlePhaseChanged(phase, items, groups) {
  state.retro.phase = phase;
  if (items) {
    state.items = items;
  }
  if (groups) {
    state.groups = groups;
  }
  // Reset typing state when phase changes
  if (phase !== 'adding') {
    state.typingActivity = { start: 0, stop: 0, continue: 0 };
    currentlyTypingIn = null;
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
  }
  updateItems();
  updatePhase();
  updateFacilitatorControls();
}

function handleTypingActivity(activity) {
  state.typingActivity = activity;
  updateTypingIndicators();
}

function handleItemsGrouped(group) {
  // Check if group already exists (adding to existing group)
  const existingGroupIndex = state.groups.findIndex((g) => g.id === group.id);
  if (existingGroupIndex >= 0) {
    // Replace the existing group with updated version
    state.groups[existingGroupIndex] = group;
  } else {
    // Add new group
    state.groups.push(group);
  }
  // Update the items to mark them as grouped
  for (const groupItem of group.items) {
    const item = state.items.find((i) => i.id === groupItem.id);
    if (item) {
      item.groupId = group.id;
    }
  }
  updateItems();
}

function handleItemsUngrouped(groupId, items) {
  // Remove the group
  state.groups = state.groups.filter((g) => g.id !== groupId);
  // Update items to mark them as ungrouped and update their data
  for (const ungroupedItem of items) {
    const item = state.items.find((i) => i.id === ungroupedItem.id);
    if (item) {
      item.groupId = null;
      item.votes = ungroupedItem.votes;
    }
  }
  updateItems();
}

function handleGroupTitleUpdated(groupId, title) {
  const group = state.groups.find((g) => g.id === groupId);
  if (group) {
    group.title = title;
    updateItems();
  }
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

  if (
    phase === 'grouping' ||
    phase === 'voting' ||
    phase === 'discussion' ||
    phase === 'complete'
  ) {
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

  // Separate ungrouped items from grouped items
  const ungroupedItems = state.items.filter((item) => !item.groupId);
  const groups = [...state.groups];

  // Sort by votes in discussion/complete phases
  if (phase === 'discussion' || phase === 'complete') {
    ungroupedItems.sort((a, b) => b.votes - a.votes);
    groups.sort((a, b) => b.votes - a.votes);
  }

  // Render groups first, then ungrouped items
  // Combine and sort by votes for proper ordering
  const allRenderables = [];

  for (const group of groups) {
    allRenderables.push({
      type: 'group',
      data: group,
      votes: group.votes,
      column: group.column,
    });
  }
  for (const item of ungroupedItems) {
    allRenderables.push({
      type: 'item',
      data: item,
      votes: item.votes,
      column: item.column,
    });
  }

  // Sort by votes in discussion/complete
  if (phase === 'discussion' || phase === 'complete') {
    allRenderables.sort((a, b) => b.votes - a.votes);
  }

  // Render each by column
  for (const column of ['start', 'stop', 'continue']) {
    const columnItems = allRenderables.filter((r) => r.column === column);
    for (const renderable of columnItems) {
      if (renderable.type === 'group') {
        renderGroup(renderable.data);
      } else {
        renderItem(renderable.data);
      }
    }
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

  for (const column of ['start', 'stop', 'continue']) {
    const container = document.getElementById(`${column}Items`);
    const typing = state.typingActivity[column] || 0;
    const count = counts[column];

    let html = '';

    // Show item count
    if (count > 0) {
      html += `<div class="item-count">${count} item${count !== 1 ? 's' : ''} added</div>`;
    }

    // Show typing indicator (excluding self)
    const othersTyping = currentlyTypingIn === column ? typing - 1 : typing;
    if (othersTyping > 0) {
      html += `<div class="typing-indicator">
        <span class="typing-dots"><span></span><span></span><span></span></span>
        ${othersTyping} ${othersTyping === 1 ? 'person is' : 'people are'} typing...
      </div>`;
    }

    container.innerHTML = html;
  }
}

function updateTypingIndicators() {
  // Only update typing indicators during adding phase
  if (state.retro?.phase === 'adding') {
    updateItemCounts();
  }
}

function renderItem(item) {
  const container = document.getElementById(`${item.column}Items`);
  const phase = state.retro.phase;

  const itemEl = document.createElement('div');
  itemEl.className = 'item';
  itemEl.id = `item-${item.id}`;

  const showVotes = phase === 'discussion' || phase === 'complete';
  const canVote = phase === 'voting';
  const canDrag = state.isFacilitator && phase === 'grouping';

  // Make items draggable for facilitator
  if (canDrag) {
    itemEl.draggable = true;
    itemEl.classList.add('draggable');
    itemEl.addEventListener('dragstart', (e) => handleDragStart(e, item.id));
    itemEl.addEventListener('dragend', handleDragEnd);
    itemEl.addEventListener('dragover', handleDragOver);
    itemEl.addEventListener('dragenter', (e) => handleDragEnter(e, item.id));
    itemEl.addEventListener('dragleave', handleDragLeave);
    itemEl.addEventListener('drop', (e) => handleDrop(e, item.id));
  }

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

function renderGroup(group) {
  const container = document.getElementById(`${group.column}Items`);
  const phase = state.retro.phase;

  const groupEl = document.createElement('div');
  groupEl.className = 'item-group';
  groupEl.id = `group-${group.id}`;

  const showVotes = phase === 'discussion' || phase === 'complete';
  const canVote = phase === 'voting';
  const canDrag = state.isFacilitator && phase === 'grouping';
  const canEditGroup = state.isFacilitator && phase === 'grouping';

  // Groups can also receive drops
  if (canDrag) {
    groupEl.addEventListener('dragover', handleDragOver);
    groupEl.addEventListener('dragenter', (e) =>
      handleDragEnterGroup(e, group.id),
    );
    groupEl.addEventListener('dragleave', handleDragLeave);
    groupEl.addEventListener('drop', (e) => handleDropOnGroup(e, group.id));
  }

  // Build group header
  const titleHtml = canEditGroup
    ? `<span class="group-title editable" onclick="startEditingGroupTitle('${group.id}')">${escapeHtml(group.title)}</span>`
    : `<span class="group-title">${escapeHtml(group.title)}</span>`;

  const ungroupBtn = canEditGroup
    ? `<button class="btn btn-small btn-ungroup" onclick="ungroupItems('${group.id}')">Ungroup</button>`
    : '';

  // Vote button for the entire group (in voting phase)
  const voteBtn = canVote
    ? `<button class="btn btn-vote ${group.votedByMe ? 'voted' : ''}" onclick="toggleGroupVote('${group.id}')">
        ${group.votedByMe ? 'Voted' : 'Vote'}
       </button>`
    : '';

  let itemsHtml = '';
  for (const item of group.items) {
    const itemDraggable = canDrag ? 'draggable="true"' : '';
    const itemDraggableClass = canDrag ? 'draggable' : '';

    // Items inside groups don't have individual vote buttons - vote on the group instead
    itemsHtml += `
      <div class="group-item ${itemDraggableClass}" id="item-${item.id}" ${itemDraggable}
           ${canDrag ? `ondragstart="handleDragStart(event, '${item.id}')" ondragend="handleDragEnd(event)"` : ''}>
        <div class="item-text">${escapeHtml(item.text)}</div>
      </div>
    `;
  }

  groupEl.innerHTML = `
    <div class="group-header">
      ${titleHtml}
      ${showVotes ? `<span class="group-votes">${group.votes} vote${group.votes !== 1 ? 's' : ''}</span>` : ''}
      ${voteBtn}
      ${ungroupBtn}
    </div>
    <div class="group-items">
      ${itemsHtml}
    </div>
  `;

  container.appendChild(groupEl);
}

// Drag and drop handlers
function handleDragStart(e, itemId) {
  draggedItemId = itemId;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', itemId);
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedItemId = null;
  // Remove all drop-target classes
  for (const el of document.querySelectorAll('.drop-target')) {
    el.classList.remove('drop-target');
  }
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e, itemId) {
  e.preventDefault();
  if (draggedItemId && draggedItemId !== itemId) {
    // Check if same column
    const draggedItem = state.items.find((i) => i.id === draggedItemId);
    const targetItem = state.items.find((i) => i.id === itemId);
    if (
      draggedItem &&
      targetItem &&
      draggedItem.column === targetItem.column &&
      !targetItem.groupId
    ) {
      e.currentTarget.classList.add('drop-target');
    }
  }
}

function handleDragEnterGroup(e, groupId) {
  e.preventDefault();
  if (draggedItemId) {
    const draggedItem = state.items.find((i) => i.id === draggedItemId);
    const targetGroup = state.groups.find((g) => g.id === groupId);
    if (
      draggedItem &&
      targetGroup &&
      draggedItem.column === targetGroup.column &&
      draggedItem.groupId !== groupId
    ) {
      e.currentTarget.classList.add('drop-target');
    }
  }
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drop-target');
}

function handleDrop(e, targetItemId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-target');

  if (!draggedItemId || draggedItemId === targetItemId) return;

  const draggedItem = state.items.find((i) => i.id === draggedItemId);
  const targetItem = state.items.find((i) => i.id === targetItemId);

  if (!draggedItem || !targetItem) return;
  if (draggedItem.column !== targetItem.column) return;
  if (draggedItem.groupId || targetItem.groupId) return;

  // Group these two items together
  ws.send(
    JSON.stringify({
      type: 'group-items',
      itemIds: [targetItemId, draggedItemId],
    }),
  );

  draggedItemId = null;
}

function handleDropOnGroup(e, groupId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-target');

  if (!draggedItemId) return;

  const draggedItem = state.items.find((i) => i.id === draggedItemId);
  const targetGroup = state.groups.find((g) => g.id === groupId);

  if (!draggedItem || !targetGroup) return;
  if (draggedItem.column !== targetGroup.column) return;
  if (draggedItem.groupId === groupId) return;

  // Add this item to the existing group
  const existingItemIds = targetGroup.items.map((i) => i.id);
  ws.send(
    JSON.stringify({
      type: 'group-items',
      itemIds: [...existingItemIds, draggedItemId],
      title: targetGroup.title,
    }),
  );

  draggedItemId = null;
}

function ungroupItems(groupId) {
  ws.send(JSON.stringify({ type: 'ungroup', groupId }));
}

function startEditingGroupTitle(groupId) {
  if (!state.isFacilitator) return;

  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;

  const groupEl = document.getElementById(`group-${groupId}`);
  const titleEl = groupEl.querySelector('.group-title');
  const currentTitle = group.title;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentTitle;
  input.className = 'group-title-input';
  input.maxLength = 100;

  input.onblur = () => finishEditingGroupTitle(groupId, input);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEditingGroupTitle(groupId, input);
    } else if (e.key === 'Escape') {
      input.value = currentTitle;
      finishEditingGroupTitle(groupId, input);
    }
  };

  titleEl.replaceWith(input);
  input.focus();
  input.select();
}

function finishEditingGroupTitle(groupId, input) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;

  const newTitle = input.value.trim() || 'Grouped Items';
  if (newTitle !== group.title) {
    ws.send(
      JSON.stringify({ type: 'update-group-title', groupId, title: newTitle }),
    );
  }

  const span = document.createElement('span');
  span.className = 'group-title editable';
  span.textContent = group.title;
  span.onclick = () => startEditingGroupTitle(groupId);
  input.replaceWith(span);
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

function updateGroupVoteUI(groupId) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;

  const groupEl = document.getElementById(`group-${groupId}`);
  if (!groupEl) return;

  const voteBtn = groupEl.querySelector('.group-header .btn-vote');
  if (voteBtn) {
    voteBtn.className = `btn btn-vote ${group.votedByMe ? 'voted' : ''}`;
    voteBtn.textContent = group.votedByMe ? 'Voted' : 'Vote';
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
    adding: { next: 'grouping', label: 'Group Similar Items' },
    grouping: { next: 'voting', label: 'Start Voting' },
    voting: { next: 'discussion', label: 'End Voting & Discuss' },
    discussion: { next: 'complete', label: 'Complete Retro' },
    complete: null,
  };

  const prevPhases = {
    waiting: null,
    adding: { prev: 'waiting', label: 'Back to Waiting' },
    grouping: { prev: 'adding', label: 'Back to Adding' },
    voting: { prev: 'grouping', label: 'Back to Grouping' },
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

  // Clear typing state after submitting
  sendTypingState(column, false);
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

function toggleGroupVote(groupId) {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return;

  if (group.votedByMe) {
    ws.send(JSON.stringify({ type: 'unvote-group', groupId }));
  } else {
    if (state.votesRemaining <= 0) {
      alert('No votes remaining! Remove a vote from another item first.');
      return;
    }
    ws.send(JSON.stringify({ type: 'vote-group', groupId }));
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
window.toggleGroupVote = toggleGroupVote;
window.ungroupItems = ungroupItems;
window.startEditingGroupTitle = startEditingGroupTitle;
window.handleDragStart = handleDragStart;
window.handleDragEnd = handleDragEnd;

// Typing state management
function sendTypingState(column, isTyping) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Only send if state actually changed
  const wasTyping = currentlyTypingIn === column;
  if (isTyping === wasTyping && isTyping) return;

  if (isTyping) {
    // Stop typing in any previous column
    if (currentlyTypingIn && currentlyTypingIn !== column) {
      ws.send(
        JSON.stringify({
          type: 'typing',
          column: currentlyTypingIn,
          isTyping: false,
        }),
      );
    }
    currentlyTypingIn = column;
    ws.send(JSON.stringify({ type: 'typing', column, isTyping: true }));
  } else if (currentlyTypingIn === column) {
    currentlyTypingIn = null;
    ws.send(JSON.stringify({ type: 'typing', column, isTyping: false }));
  }
}

function handleTextareaInput(column) {
  const textarea = document.getElementById(`${column}Input`);
  const hasContent = textarea.value.trim().length > 0;

  if (hasContent) {
    sendTypingState(column, true);

    // Reset typing timeout - stop typing indicator after 3s of no input
    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }
    typingTimeout = setTimeout(() => {
      sendTypingState(column, false);
    }, 3000);
  } else {
    // Empty textarea - stop typing
    sendTypingState(column, false);
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
  }
}

function handleTextareaBlur(column) {
  // When leaving a textarea, check if it's empty and stop typing
  const textarea = document.getElementById(`${column}Input`);
  if (!textarea.value.trim()) {
    sendTypingState(column, false);
  }
}

// Setup Enter key handling and typing detection for add item textareas
function setupTextareaHandlers() {
  for (const column of ['start', 'stop', 'continue']) {
    const textarea = document.getElementById(`${column}Input`);
    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          addItem(column);
        }
      });

      // Typing detection
      textarea.addEventListener('input', () => handleTextareaInput(column));
      textarea.addEventListener('blur', () => handleTextareaBlur(column));
    }
  }
}

// Start
init();
setupTextareaHandlers();
