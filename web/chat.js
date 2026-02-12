/**
 * Facility Web Chat — Browser Client
 *
 * Connects to the facility-web plugin WebSocket,
 * handles PIN + passphrase authentication, and manages the chat UI.
 */
(function () {
  "use strict";

  // --- State ---
  let ws = null;
  let currentUser = null;
  let pin = "";
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  const MAX_RECONNECT = 10;
  const RECONNECT_DELAY_BASE = 1000;

  // Admin panel state
  let adminUsers = [];
  let selectedAdminUserId = "";

  // --- DOM refs ---
  const loginScreen = document.getElementById("login-screen");
  const passphraseScreen = document.getElementById("passphrase-screen");
  const chatScreen = document.getElementById("chat-screen");
  const pinDots = document.querySelectorAll(".pin-dot");
  const pinKeys = document.querySelectorAll(".pin-key[data-key]");
  const loginError = document.getElementById("login-error");
  const loginStatus = document.getElementById("login-status");
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const agentName = document.getElementById("agent-name");
  const userName = document.getElementById("user-name");
  const logoutBtn = document.getElementById("logout-btn");
  const auditBtn = document.getElementById("audit-btn");
  const auditPanel = document.getElementById("audit-panel");
  const auditClose = document.getElementById("audit-close");
  const auditEntries = document.getElementById("audit-entries");
  const auditChildFilter = document.getElementById("audit-child-filter");
  const auditDaysFilter = document.getElementById("audit-days-filter");

  // Passphrase refs
  const passphraseGreeting = document.getElementById("passphrase-greeting");
  const passphraseInput = document.getElementById("passphrase-input");
  const passphraseSubmit = document.getElementById("passphrase-submit");
  const passphraseError = document.getElementById("passphrase-error");
  const passphraseBack = document.getElementById("passphrase-back");

  // Admin refs
  const adminBtn = document.getElementById("admin-btn");
  const adminPanel = document.getElementById("admin-panel");
  const adminClose = document.getElementById("admin-close");
  const adminUserSelect = document.getElementById("admin-user-select");
  const adminUserDetails = document.getElementById("admin-user-details");
  const adminPin = document.getElementById("admin-pin");
  const adminSavePin = document.getElementById("admin-save-pin");
  const adminPassphraseSection = document.getElementById("admin-passphrase-section");
  const adminPassphrase = document.getElementById("admin-passphrase");
  const adminSavePassphrase = document.getElementById("admin-save-passphrase");
  const adminClearPassphrase = document.getElementById("admin-clear-passphrase");
  const adminPassphraseStatus = document.getElementById("admin-passphrase-status");
  const adminMacRequired = document.getElementById("admin-mac-required");
  const adminSaveMacRequired = document.getElementById("admin-save-mac-required");
  const adminDevicesList = document.getElementById("admin-devices-list");
  const adminAddThisDevice = document.getElementById("admin-add-this-device");
  const adminBrowseLan = document.getElementById("admin-browse-lan");
  const adminStatus = document.getElementById("admin-status");

  // LAN modal refs
  const lanModal = document.getElementById("lan-modal");
  const lanModalClose = document.getElementById("lan-modal-close");
  const lanModalCurrent = document.getElementById("lan-modal-current");
  const lanDeviceList = document.getElementById("lan-device-list");

  // --- WebSocket Connection ---
  const WS_PORT = 18790;

  function getWsUrl() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.hostname + ":" + WS_PORT;
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    loginStatus.textContent = "Connecting...";
    loginStatus.className = "status-message";

    try {
      ws = new WebSocket(getWsUrl());
    } catch (err) {
      loginStatus.textContent = "Connection failed.";
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      reconnectAttempts = 0;
      loginStatus.textContent = "Connected — enter your PIN";
      loginStatus.className = "status-message connected";
    };

    ws.onmessage = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      handleMessage(msg);
    };

    ws.onclose = function () {
      if (currentUser) {
        addSystemMessage("Connection lost. Reconnecting...");
      }
      loginStatus.textContent = "Disconnected";
      loginStatus.className = "status-message";
      scheduleReconnect();
    };

    ws.onerror = function () {
      // onclose will fire after this
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    if (reconnectAttempts >= MAX_RECONNECT) {
      loginStatus.textContent = "Unable to connect. Refresh the page.";
      return;
    }
    var delay = RECONNECT_DELAY_BASE * Math.pow(1.5, reconnectAttempts);
    reconnectAttempts++;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, Math.min(delay, 15000));
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // --- Message Handler ---
  function handleMessage(msg) {
    switch (msg.type) {
      case "welcome":
        break;

      case "auth_result":
        if (msg.success) {
          currentUser = msg.user;
          showChatScreen();
          addSystemMessage("Connected as " + msg.user.name + ". Your agent is ready.");
        } else {
          // If we're on passphrase screen, the auth failure came from a rate-limit on passphrase
          if (passphraseScreen.classList.contains("active")) {
            showPassphraseError(msg.error || "Authentication failed.");
          } else {
            showPinError(msg.error || "Authentication failed.");
          }
        }
        break;

      case "passphrase_prompt":
        showPassphraseScreen(msg.userName);
        break;

      case "passphrase_error":
        showPassphraseError(msg.error || "Invalid passphrase.");
        break;

      case "chat_event":
        handleChatEvent(msg);
        break;

      case "audit_result":
        renderAuditEntries(msg.entries || []);
        break;

      case "admin_users_result":
        adminUsers = msg.users || [];
        populateAdminUserList();
        break;

      case "admin_lan_scan_result":
        showLanModal(msg.devices || [], msg.currentMac);
        break;

      case "admin_result":
        handleAdminResult(msg);
        break;

      case "error":
        if (currentUser) {
          addSystemMessage("Error: " + msg.error);
        } else {
          showPinError(msg.error);
        }
        break;
    }
  }

  function handleChatEvent(msg) {
    switch (msg.event) {
      case "token":
        appendToAgentMessage(msg.data);
        break;
      case "done":
        finalizeAgentMessage(msg.data);
        break;
      case "thinking":
        showThinking(msg.data);
        break;
      case "agent_push":
        if (msg.data) addMessage(msg.data, "agent");
        break;
      case "tool":
        if (msg.data) addSystemMessage("[tool] " + msg.data);
        break;
      case "error":
        addSystemMessage("Agent error: " + msg.data);
        break;
    }
  }

  // --- PIN Pad ---
  function updatePinDisplay() {
    pinDots.forEach(function (dot, i) {
      dot.className = "pin-dot" + (i < pin.length ? " filled" : "");
    });
  }

  function showPinError(message) {
    loginError.textContent = message;
    pinDots.forEach(function (dot) { dot.classList.add("error"); });
    setTimeout(function () {
      pin = "";
      updatePinDisplay();
      loginError.textContent = "";
    }, 1200);
  }

  function handlePinKey(key) {
    loginError.textContent = "";
    if (key === "back") {
      pin = pin.slice(0, -1);
      updatePinDisplay();
      return;
    }
    if (pin.length >= 4) return;
    pin += key;
    updatePinDisplay();

    if (pin.length === 4) {
      send({ type: "auth", pin: pin });
      pin = "";
    }
  }

  pinKeys.forEach(function (key) {
    key.addEventListener("click", function () {
      var k = key.getAttribute("data-key");
      if (k) handlePinKey(k);
    });
  });

  document.addEventListener("keydown", function (e) {
    if (!loginScreen.classList.contains("active")) return;
    if (e.key >= "0" && e.key <= "9") handlePinKey(e.key);
    if (e.key === "Backspace") handlePinKey("back");
  });

  // --- Passphrase Screen ---
  function showPassphraseScreen(userName) {
    loginScreen.classList.remove("active");
    chatScreen.classList.remove("active");
    passphraseScreen.classList.add("active");
    passphraseGreeting.textContent = "Welcome, " + userName;
    passphraseInput.value = "";
    passphraseError.textContent = "";
    passphraseInput.focus();
  }

  function showPassphraseError(message) {
    passphraseError.textContent = message;
    passphraseInput.value = "";
    passphraseInput.focus();
  }

  function submitPassphrase() {
    var value = passphraseInput.value.trim();
    if (!value) return;
    send({ type: "passphrase", passphrase: value });
    passphraseInput.value = "";
  }

  passphraseSubmit.addEventListener("click", submitPassphrase);

  passphraseInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitPassphrase();
    }
  });

  passphraseBack.addEventListener("click", function () {
    passphraseScreen.classList.remove("active");
    loginScreen.classList.add("active");
    pin = "";
    updatePinDisplay();
    loginError.textContent = "";
  });

  // --- Screen Transitions ---
  function showChatScreen() {
    loginScreen.classList.remove("active");
    passphraseScreen.classList.remove("active");
    chatScreen.classList.add("active");
    agentName.textContent = currentUser.agent;
    userName.textContent = currentUser.name;

    var isParentAdmin = currentUser.role === "parent" || currentUser.role === "admin";
    auditBtn.style.display = isParentAdmin ? "" : "none";
    adminBtn.style.display = isParentAdmin ? "" : "none";

    chatInput.focus();
  }

  function showLoginScreen() {
    chatScreen.classList.remove("active");
    passphraseScreen.classList.remove("active");
    loginScreen.classList.add("active");
    auditPanel.classList.remove("open");
    adminPanel.classList.remove("open");
    auditBtn.style.display = "none";
    adminBtn.style.display = "none";
    currentUser = null;
    pin = "";
    updatePinDisplay();
    chatMessages.innerHTML = "";
    loginError.textContent = "";
  }

  logoutBtn.addEventListener("click", function () {
    showLoginScreen();
    if (ws) ws.close();
  });

  // --- Chat Messages ---
  var currentAgentBubble = null;

  var IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

  function hasImages(text) {
    IMG_RE.lastIndex = 0;
    return IMG_RE.test(text);
  }

  function renderRichContent(text) {
    var frag = document.createDocumentFragment();
    IMG_RE.lastIndex = 0;
    var lastIndex = 0;
    var match;

    while ((match = IMG_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        var pre = document.createElement("span");
        pre.className = "message-text";
        pre.textContent = text.slice(lastIndex, match.index);
        frag.appendChild(pre);
      }

      var alt = match[1];
      var src = match[2];

      if (src.startsWith("/facility-chat/media/") || src.startsWith("https://") || src.startsWith("http://")) {
        var wrapper = document.createElement("div");
        wrapper.className = "message-image-wrapper";
        var img = document.createElement("img");
        img.className = "message-image";
        img.alt = alt || "Image";
        img.src = src;
        img.loading = "lazy";
        img.addEventListener("click", function () {
          window.open(this.src, "_blank");
        });
        img.addEventListener("error", function () {
          this.style.display = "none";
          var errSpan = document.createElement("span");
          errSpan.className = "message-text";
          errSpan.textContent = "[Image failed to load: " + (alt || src) + "]";
          this.parentNode.appendChild(errSpan);
        });
        wrapper.appendChild(img);
        if (alt) {
          var caption = document.createElement("div");
          caption.className = "message-image-caption";
          caption.textContent = alt;
          wrapper.appendChild(caption);
        }
        frag.appendChild(wrapper);
      } else {
        var fallback = document.createElement("span");
        fallback.className = "message-text";
        fallback.textContent = match[0];
        frag.appendChild(fallback);
      }

      lastIndex = IMG_RE.lastIndex;
    }

    if (lastIndex < text.length) {
      var post = document.createElement("span");
      post.className = "message-text";
      post.textContent = text.slice(lastIndex);
      frag.appendChild(post);
    }

    return frag;
  }

  function addMessage(text, type) {
    var div = document.createElement("div");
    div.className = "message message-" + type;

    if (type === "agent" && hasImages(text)) {
      div.appendChild(renderRichContent(text));
    } else {
      var textSpan = document.createElement("span");
      textSpan.className = "message-text";
      textSpan.textContent = text;
      div.appendChild(textSpan);
    }

    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function addSystemMessage(text) {
    var div = document.createElement("div");
    div.className = "message message-system";
    div.textContent = text;
    chatMessages.appendChild(div);
    scrollToBottom();
  }

  function appendToAgentMessage(text) {
    if (!currentAgentBubble) {
      currentAgentBubble = addMessage("", "agent");
    }
    var textEl = currentAgentBubble.querySelector(".message-text");
    textEl.textContent += text;
    scrollToBottom();
  }

  function finalizeAgentMessage(text) {
    var finalText = text;
    if (!finalText && currentAgentBubble) {
      var streamedEl = currentAgentBubble.querySelector(".message-text");
      if (streamedEl) finalText = streamedEl.textContent;
    }

    if (finalText) {
      if (!currentAgentBubble) {
        addMessage(finalText, "agent");
      } else if (hasImages(finalText)) {
        currentAgentBubble.innerHTML = "";
        currentAgentBubble.appendChild(renderRichContent(finalText));
      } else {
        var textEl = currentAgentBubble.querySelector(".message-text");
        textEl.textContent = finalText;
      }
    }
    currentAgentBubble = null;
    removeThinking();
    scrollToBottom();
  }

  function showThinking(text) {
    removeThinking();
    var div = document.createElement("div");
    div.className = "message message-thinking";
    div.id = "thinking-indicator";
    div.innerHTML = (text || "Thinking") + '<span class="typing-indicator"></span>';
    chatMessages.appendChild(div);
    scrollToBottom();
  }

  function removeThinking() {
    var el = document.getElementById("thinking-indicator");
    if (el) el.remove();
  }

  function scrollToBottom() {
    requestAnimationFrame(function () {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  // --- Chat Input ---
  function sendMessage() {
    var text = chatInput.value.trim();
    if (!text || !currentUser) return;

    addMessage(text, "user");
    send({ type: "chat_message", text: text });
    chatInput.value = "";
    chatInput.style.height = "auto";
    updateSendButton();
  }

  function updateSendButton() {
    sendBtn.disabled = !chatInput.value.trim() || !currentUser;
  }

  sendBtn.addEventListener("click", sendMessage);

  chatInput.addEventListener("input", function () {
    updateSendButton();
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });

  chatInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // --- Audit Panel ---
  function requestAudit() {
    var childId = auditChildFilter.value || undefined;
    var days = parseInt(auditDaysFilter.value, 10) || 7;
    send({
      type: "audit_query",
      childId: childId,
      since: Date.now() - days * 86400000,
      limit: 200,
    });
  }

  function renderAuditEntries(entries) {
    auditEntries.innerHTML = "";
    if (entries.length === 0) {
      auditEntries.innerHTML = '<div class="audit-empty">No activity found for this period.</div>';
      return;
    }

    var seen = new Set();
    entries.forEach(function (e) { seen.add(e.userId + "|" + e.userName); });
    var currentFilter = auditChildFilter.value;
    auditChildFilter.innerHTML = '<option value="">All children</option>';
    seen.forEach(function (key) {
      var parts = key.split("|");
      var opt = document.createElement("option");
      opt.value = parts[0];
      opt.textContent = parts[1];
      auditChildFilter.appendChild(opt);
    });
    auditChildFilter.value = currentFilter;

    entries.forEach(function (e) {
      var div = document.createElement("div");
      div.className = "audit-entry";

      var header = document.createElement("div");
      header.className = "audit-entry-header";

      var who = document.createElement("span");
      who.className = "audit-entry-who";
      who.textContent = e.userName + " / " + e.agent;

      var time = document.createElement("span");
      time.className = "audit-entry-time";
      time.textContent = formatAuditTime(e.ts);

      header.appendChild(who);
      header.appendChild(time);

      var body = document.createElement("div");
      var dirTag = document.createElement("span");
      dirTag.className = "audit-entry-dir " + e.dir;
      dirTag.textContent = e.dir === "inbound" ? "child" : "agent";

      var preview = document.createElement("span");
      preview.className = "audit-entry-preview";
      preview.textContent = e.preview;

      body.appendChild(dirTag);
      body.appendChild(preview);

      div.appendChild(header);
      div.appendChild(body);
      auditEntries.appendChild(div);
    });
  }

  function formatAuditTime(ts) {
    var d = new Date(ts);
    var now = new Date();
    var timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return timeStr;
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + timeStr;
  }

  auditBtn.addEventListener("click", function () {
    auditPanel.classList.toggle("open");
    if (auditPanel.classList.contains("open")) requestAudit();
  });

  auditClose.addEventListener("click", function () {
    auditPanel.classList.remove("open");
  });

  auditChildFilter.addEventListener("change", requestAudit);
  auditDaysFilter.addEventListener("change", requestAudit);

  // --- Admin Panel ---
  adminBtn.addEventListener("click", function () {
    adminPanel.classList.toggle("open");
    if (adminPanel.classList.contains("open")) {
      send({ type: "admin_get_users" });
    }
  });

  adminClose.addEventListener("click", function () {
    adminPanel.classList.remove("open");
  });

  function populateAdminUserList() {
    adminUserSelect.innerHTML = '<option value="">Select a user...</option>';
    adminUsers.forEach(function (u) {
      var opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.name + " (" + u.role + ")";
      adminUserSelect.appendChild(opt);
    });
    // Re-select previously selected user
    if (selectedAdminUserId) {
      adminUserSelect.value = selectedAdminUserId;
      showAdminUserDetails(selectedAdminUserId);
    }
  }

  adminUserSelect.addEventListener("change", function () {
    selectedAdminUserId = adminUserSelect.value;
    showAdminUserDetails(selectedAdminUserId);
  });

  function showAdminUserDetails(userId) {
    if (!userId) {
      adminUserDetails.style.display = "none";
      return;
    }

    var user = adminUsers.find(function (u) { return u.id === userId; });
    if (!user) {
      adminUserDetails.style.display = "none";
      return;
    }

    adminUserDetails.style.display = "";
    adminPin.value = "";
    adminPassphrase.value = "";

    // Show passphrase section only for parent/admin
    if (user.role === "parent" || user.role === "admin") {
      adminPassphraseSection.style.display = "";
      adminPassphraseStatus.textContent = user.hasPassphrase ? "Passphrase is set" : "No passphrase";
      adminPassphraseStatus.className = "admin-field-status " + (user.hasPassphrase ? "set" : "unset");
    } else {
      adminPassphraseSection.style.display = "none";
    }

    adminMacRequired.checked = user.macRequired;
    renderAdminDevices(user.macs);

    // Show remove button (but not for yourself)
    if (currentUser && userId !== currentUser.id) {
      adminRemoveSection.style.display = "";
    } else {
      adminRemoveSection.style.display = "none";
    }
  }

  function renderAdminDevices(macs) {
    adminDevicesList.innerHTML = "";
    if (macs.length === 0) {
      adminDevicesList.innerHTML = '<div class="admin-empty">No devices registered</div>';
      return;
    }
    macs.forEach(function (mac) {
      var item = document.createElement("div");
      item.className = "admin-device-item";

      var macSpan = document.createElement("span");
      macSpan.className = "admin-device-mac";
      macSpan.textContent = mac;

      var removeBtn = document.createElement("button");
      removeBtn.className = "btn-admin-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", function () {
        send({ type: "admin_remove_mac", userId: selectedAdminUserId, mac: mac });
      });

      item.appendChild(macSpan);
      item.appendChild(removeBtn);
      adminDevicesList.appendChild(item);
    });
  }

  // Admin save handlers
  adminSavePin.addEventListener("click", function () {
    if (!selectedAdminUserId) return;
    var newPin = adminPin.value.trim();
    if (!/^\d{4}$/.test(newPin)) {
      showAdminStatus("PIN must be exactly 4 digits.", true);
      return;
    }
    send({ type: "admin_update_user", userId: selectedAdminUserId, updates: { pin: newPin } });
  });

  adminSavePassphrase.addEventListener("click", function () {
    if (!selectedAdminUserId) return;
    var newPass = adminPassphrase.value;
    if (!newPass.trim()) {
      showAdminStatus("Enter a passphrase or use Clear.", true);
      return;
    }
    send({ type: "admin_update_user", userId: selectedAdminUserId, updates: { passphrase: newPass } });
  });

  adminClearPassphrase.addEventListener("click", function () {
    if (!selectedAdminUserId) return;
    send({ type: "admin_update_user", userId: selectedAdminUserId, updates: { passphrase: "" } });
  });

  adminSaveMacRequired.addEventListener("click", function () {
    if (!selectedAdminUserId) return;
    send({ type: "admin_update_user", userId: selectedAdminUserId, updates: { macRequired: adminMacRequired.checked } });
  });

  adminAddThisDevice.addEventListener("click", function () {
    if (!selectedAdminUserId) return;
    send({ type: "admin_add_current_device", userId: selectedAdminUserId });
  });

  adminBrowseLan.addEventListener("click", function () {
    if (!selectedAdminUserId) return;
    send({ type: "admin_lan_scan" });
  });

  // Admin add/remove user refs
  var adminNewId = document.getElementById("admin-new-id");
  var adminNewName = document.getElementById("admin-new-name");
  var adminNewPin = document.getElementById("admin-new-pin");
  var adminNewAgent = document.getElementById("admin-new-agent");
  var adminNewRole = document.getElementById("admin-new-role");
  var adminCreateUser = document.getElementById("admin-create-user");
  var adminRemoveSection = document.getElementById("admin-remove-section");
  var adminRemoveUser = document.getElementById("admin-remove-user");

  adminCreateUser.addEventListener("click", function () {
    var id = adminNewId.value.trim();
    var name = adminNewName.value.trim();
    var pin = adminNewPin.value.trim();
    var agent = adminNewAgent.value.trim();
    var role = adminNewRole.value;
    if (!id || !name || !pin || !agent) {
      showAdminStatus("All fields are required.", true);
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      showAdminStatus("PIN must be exactly 4 digits.", true);
      return;
    }
    send({
      type: "admin_add_user",
      user: { id: id, name: name, pin: pin, agent: agent, role: role },
    });
    adminNewId.value = "";
    adminNewName.value = "";
    adminNewPin.value = "";
    adminNewAgent.value = "";
    adminNewRole.value = "child";
  });

  adminRemoveUser.addEventListener("click", function () {
    if (!selectedAdminUserId) return;
    var user = adminUsers.find(function (u) { return u.id === selectedAdminUserId; });
    var label = user ? user.name : selectedAdminUserId;
    if (!confirm("Remove user \"" + label + "\"? This cannot be undone.")) return;
    send({ type: "admin_remove_user", userId: selectedAdminUserId });
    selectedAdminUserId = "";
  });

  function handleAdminResult(msg) {
    if (msg.success) {
      showAdminStatus("Saved.", false);
      if (msg.users) {
        adminUsers = msg.users;
        populateAdminUserList();
      }
    } else {
      showAdminStatus(msg.error || "Operation failed.", true);
    }
  }

  function showAdminStatus(text, isError) {
    adminStatus.textContent = text;
    adminStatus.className = "admin-status " + (isError ? "error" : "success");
    setTimeout(function () {
      adminStatus.textContent = "";
      adminStatus.className = "admin-status";
    }, 3000);
  }

  // --- LAN Device Picker ---
  function showLanModal(devices, currentMac) {
    lanModal.style.display = "";
    lanModalCurrent.textContent = currentMac
      ? "Your device: " + currentMac
      : "Your device MAC could not be detected";

    lanDeviceList.innerHTML = "";
    if (devices.length === 0) {
      lanDeviceList.innerHTML = '<div class="admin-empty">No devices found on LAN</div>';
      return;
    }

    devices.forEach(function (dev) {
      var item = document.createElement("div");
      item.className = "lan-device-item";
      if (dev.mac === currentMac) item.classList.add("current");

      var info = document.createElement("span");
      info.className = "lan-device-info";
      info.textContent = dev.ip + "  —  " + dev.mac;

      var addBtn = document.createElement("button");
      addBtn.className = "btn-admin-action btn-small";
      addBtn.textContent = "Add";
      addBtn.addEventListener("click", function () {
        send({ type: "admin_add_mac", userId: selectedAdminUserId, mac: dev.mac });
        lanModal.style.display = "none";
      });

      item.appendChild(info);
      item.appendChild(addBtn);
      lanDeviceList.appendChild(item);
    });
  }

  lanModalClose.addEventListener("click", function () {
    lanModal.style.display = "none";
  });

  lanModal.addEventListener("click", function (e) {
    if (e.target === lanModal) lanModal.style.display = "none";
  });

  // --- Init ---
  connect();
})();
