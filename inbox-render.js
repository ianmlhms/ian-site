const ACCOUNT_STALE_MS = 5 * 60 * 1000;
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const SERVICE_DETAILS = Object.freeze({
  whatsapp: Object.freeze({ icon: "💬", name: "WhatsApp" }),
  imessage: Object.freeze({ icon: "🍎", name: "iMessage" }),
});

const STATUS_LABELS = Object.freeze({
  connected: "verbonnen",
  connecting: "gëtt verbonnen…",
  error: "Feeler",
  offline: "offline",
  online: "online",
  qr: "QR-Code néideg",
});

const KIND_DETAILS = Object.freeze({
  image: Object.freeze({ icon: "📷", label: "Bild" }),
  video: Object.freeze({ icon: "🎥", label: "Video" }),
  audio: Object.freeze({ icon: "🎤", label: "Sproochnoriicht" }),
  file: Object.freeze({ icon: "📎", label: "Fichier" }),
  system: Object.freeze({ icon: "⚙️", label: "System" }),
});

const element = (id) => document.getElementById(id);

function emptyNode(node) {
  node.replaceChildren();
  return node;
}

function textNode(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function serviceLabel(service) {
  const detail = SERVICE_DETAILS[service] || { icon: "•", name: service || "Onbekannt" };
  return `${detail.icon} ${detail.name}`;
}

export function relativeTime(iso, now = Date.now()) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE_MS) return "elo";
  if (elapsed < HOUR_MS) return `virun ${Math.floor(elapsed / MINUTE_MS)} Min.`;
  if (elapsed < DAY_MS) return `virun ${Math.floor(elapsed / HOUR_MS)} St.`;
  const days = Math.floor(elapsed / DAY_MS);
  if (days < 7) return `virun ${days} D.`;
  return new Date(iso).toLocaleDateString("lb-LU", { day: "2-digit", month: "2-digit" });
}

export function showNotice(message, tone = "error") {
  const notice = element("notice");
  notice.textContent = message || "";
  notice.className = message ? `notice show ${tone}` : "notice";
}

export function renderGate(isVisible, onSignIn) {
  const gate = element("gate");
  const app = element("app");
  gate.style.display = isVisible ? "flex" : "none";
  app.style.display = isVisible ? "none" : "flex";
  if (!isVisible) return;
  const button = element("gateSignIn");
  button.onclick = onSignIn;
}

// Signed URLs cost a round trip and expire, so each chat's avatar is resolved
// once per page load and reused for every re-render of the list.
const avatarUrlCache = new Map();

function initialsOf(title) {
  const words = String(title || "?").trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0] || "").join("").toUpperCase() || "?";
}

function chatAvatar(chat, createMediaUrl) {
  const avatar = document.createElement("span");
  avatar.className = "chat-avatar";
  avatar.textContent = initialsOf(chat.title);
  if (!chat.avatar_path || typeof createMediaUrl !== "function") return avatar;

  const cached = avatarUrlCache.get(chat.avatar_path);
  if (cached) {
    applyAvatarImage(avatar, cached, chat.title);
    return avatar;
  }
  createMediaUrl(chat.avatar_path)
    .then((url) => {
      avatarUrlCache.set(chat.avatar_path, url);
      applyAvatarImage(avatar, url, chat.title);
    })
    .catch(() => { /* initials stay; a missing avatar is not worth an error */ });
  return avatar;
}

function applyAvatarImage(host, url, title) {
  const image = document.createElement("img");
  image.src = url;
  image.alt = title || "";
  image.loading = "lazy";
  image.onload = () => { host.textContent = ""; host.append(image); };
}

export function renderChatList(chats, selectedChatId, onSelect, createMediaUrl) {
  const list = emptyNode(element("chatList"));
  if (!chats.length) {
    list.append(textNode("li", "empty", "Keng Chats an dësem Filter."));
    return;
  }
  chats.forEach((chat) => list.append(chatRow(chat, selectedChatId, onSelect, createMediaUrl)));
}

function chatRow(chat, selectedChatId, onSelect, createMediaUrl) {
  const item = document.createElement("li");
  item.className = `chat-row${chat.unread ? " unread" : ""}${chat.id === selectedChatId ? " active" : ""}`;
  const button = document.createElement("button");
  button.type = "button";
  button.onclick = () => onSelect(chat.id);
  const top = textNode("span", "chat-row-top", "");
  top.append(
    textNode("span", "chat-title", chat.title || "Chat ouni Numm"),
    textNode("time", "chat-time", relativeTime(chat.last_at)),
  );
  const bottom = textNode("span", "chat-row-bottom", "");
  bottom.append(
    textNode("span", `service-badge ${chat.service}`, serviceLabel(chat.service)),
    textNode("span", "chat-preview", chat.last_preview || "Nach keng Virschau"),
  );
  const texts = document.createElement("span");
  texts.className = "chat-row-texts";
  texts.append(top, bottom);
  button.append(chatAvatar(chat, createMediaUrl), texts);
  item.append(button);
  return item;
}

export function renderSearchResults(results, chatsById, onSelect) {
  const list = emptyNode(element("chatList"));
  if (!results.length) {
    list.append(textNode("li", "empty", "Keng passend Noriichte fonnt."));
    return;
  }
  results.forEach((message) => {
    const chat = chatsById[message.chat_id];
    const item = document.createElement("li");
    item.className = "search-result";
    const button = document.createElement("button");
    button.type = "button";
    button.onclick = () => onSelect(message.chat_id, message.remote_id);
    button.append(
      textNode("span", "search-chat", `${serviceLabel(message.service)} · ${chat?.title || "Chat"}`),
      textNode("span", "search-body", message.body || ""),
      textNode("time", "search-time", relativeTime(message.sent_at)),
    );
    item.append(button);
    list.append(item);
  });
}

function accountState(account, now) {
  if (!account) return Object.freeze({ className: "missing", label: "net ageriicht" });
  const lastSeen = new Date(account.last_seen_at).getTime();
  const isStale = !Number.isFinite(lastSeen) || now - lastSeen > ACCOUNT_STALE_MS;
  const status = STATUS_LABELS[account.status] || account.status || "onbekannt";
  if (isStale) return Object.freeze({ className: "stale", label: `${status} · al` });
  return Object.freeze({ className: "fresh", label: status });
}

export function renderAccounts(accounts, now = Date.now()) {
  const strip = emptyNode(element("connectionStrip"));
  ["whatsapp", "imessage"].forEach((service) => {
    const account = accounts.find((entry) => entry.service === service);
    strip.append(accountItem(service, account, accountState(account, now)));
  });
}

function accountItem(service, account, state) {
  const item = document.createElement("div");
  item.className = `account-state ${state.className}`;
  const heading = textNode("span", "account-heading", serviceLabel(service));
  const status = textNode("span", "account-status", state.label);
  const seen = account?.last_seen_at
    ? textNode("span", "account-seen", `Lescht Signal: ${relativeTime(account.last_seen_at)}`)
    : textNode("span", "account-seen", "Nach kee Signal");
  item.append(heading, status, seen);
  if (account?.error) item.append(textNode("span", "account-error", account.error));
  if (service === "whatsapp" && account?.qr_payload) item.append(qrPayload(account.qr_payload));
  return item;
}

function qrPayload(payload) {
  const details = document.createElement("details");
  details.className = "qr-payload";
  const summary = document.createElement("summary");
  summary.textContent = "WhatsApp verbannen";
  const note = textNode("p", "", "Scan an WhatsApp ▸ Verbonnen Apparater.");
  const code = document.createElement("code");
  code.textContent = payload;
  details.append(summary, note, code);
  return details;
}

export function renderChatHeader(chat, onBack) {
  const header = emptyNode(element("chatHead"));
  if (!chat) {
    header.append(textNode("span", "", "Wiel e Chat aus ←"));
    return;
  }
  const back = document.createElement("button");
  back.type = "button";
  back.className = "back-btn";
  back.setAttribute("aria-label", "Zréck bei d'Chatlëscht");
  back.textContent = "‹";
  back.onclick = onBack;
  const labels = document.createElement("span");
  labels.className = "chat-head-labels";
  labels.append(
    textNode("strong", "", chat.title || "Chat ouni Numm"),
    textNode("small", "", serviceLabel(chat.service)),
  );
  header.append(back, labels);
}

function reactionNodes(reactions) {
  const host = document.createElement("span");
  host.className = "reactions";
  Object.entries(reactions || {}).forEach(([emoji, senders]) => {
    if (!Array.isArray(senders) || !senders.length) return;
    host.append(textNode("span", "reaction-pill", `${emoji} ${senders.length}`));
  });
  return host;
}

function kindDetail(kind) {
  return KIND_DETAILS[kind] || KIND_DETAILS.file;
}

function mediaChip(message, onRequest) {
  const detail = kindDetail(message.kind);
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "media-chip";
  chip.textContent = `${detail.icon} ${detail.label}`;
  if (message.media_state === "none") {
    chip.title = "Tippe fir d'Media ze lueden";
    chip.onclick = () => onRequest(message.id);
    return chip;
  }
  if (message.media_state === "requested") {
    chip.disabled = true;
    chip.textContent = `${detail.icon} ${detail.label} · gëtt gelueden…`;
  }
  return chip;
}

function attachMediaError(media, host, onError) {
  media.addEventListener("error", () => {
    host.replaceChildren(textNode("span", "media-error", "Media net verfügbar."));
    onError(new Error("D'Media konnt net ugewise ginn."));
  }, { once: true });
}

function renderLoadedMedia(host, message, mediaUrl, thumbUrl, onError) {
  const url = mediaUrl || thumbUrl;
  if (!url) return;
  host.replaceChildren();
  if (message.kind === "image" || (!mediaUrl && thumbUrl)) {
    const image = document.createElement("img");
    image.className = "message-media";
    image.src = url;
    image.alt = kindDetail(message.kind).label;
    attachMediaError(image, host, onError);
    host.append(image);
    return;
  }
  if (message.kind === "video") {
    const video = document.createElement("video");
    video.className = "message-media";
    video.controls = true;
    video.src = mediaUrl;
    if (thumbUrl) video.poster = thumbUrl;
    attachMediaError(video, host, onError);
    host.append(video);
    return;
  }
  if (message.kind === "audio") {
    const audio = document.createElement("audio");
    audio.className = "message-audio";
    audio.controls = true;
    audio.src = url;
    attachMediaError(audio, host, onError);
    host.append(audio);
    return;
  }
  const link = document.createElement("a");
  link.className = "media-chip available";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = `${kindDetail(message.kind).icon} ${kindDetail(message.kind).label} opmaachen`;
  host.append(link);
}

async function hydrateMedia(host, message, createUrl, onError) {
  if (!message.media_path && !message.thumb_path) return;
  try {
    const [mediaUrl, thumbUrl] = await Promise.all([
      message.media_path ? createUrl(message.media_path) : Promise.resolve(null),
      message.thumb_path ? createUrl(message.thumb_path) : Promise.resolve(null),
    ]);
    renderLoadedMedia(host, message, mediaUrl, thumbUrl, onError);
  } catch (error) {
    host.append(textNode("span", "media-error", "Media net verfügbar."));
    onError(error);
  }
}

function messageNode(message, options) {
  const row = document.createElement("article");
  row.className = `message${message.is_from_me ? " mine" : ""}`;
  row.dataset.remoteId = message.remote_id;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (message.reply_to_remote_id || message.reply_preview) {
    const quote = textNode("blockquote", "reply-quote", message.reply_preview || "Beäntwert Noriicht");
    bubble.append(quote);
  }
  if (message.body) bubble.append(textNode("p", "message-body", message.body));
  if (message.kind !== "text") {
    const mediaHost = document.createElement("div");
    mediaHost.className = "media-host";
    mediaHost.append(mediaChip(message, options.onMediaRequest));
    bubble.append(mediaHost);
    void hydrateMedia(mediaHost, message, options.createMediaUrl, options.onError);
  }
  const meta = document.createElement("span");
  meta.className = "message-meta";
  const edited = message.edited_at ? " · (geännert)" : "";
  meta.textContent = `${new Date(message.sent_at).toLocaleTimeString("lb-LU", { hour: "2-digit", minute: "2-digit" })}${edited}`;
  bubble.append(meta, reactionNodes(message.reactions));
  row.append(bubble);
  return row;
}

function pendingNode(pending, onRetry) {
  const row = document.createElement("article");
  row.className = `message mine ${pending.status === "sent" ? "settled" : "pending"}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.append(textNode("p", "message-body", pending.body));
  const label = pending.status === "failed"
    ? `Feeler: ${pending.error || "Noriicht net geschéckt"}`
    : pending.status === "sent" ? "geschéckt" : "gëtt geschéckt…";
  bubble.append(textNode("span", `pending-state ${pending.status}`, label));
  if (pending.status === "failed") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "retry-btn";
    retry.textContent = "Nach eng Kéier";
    retry.onclick = () => onRetry(pending.localId);
    bubble.append(retry);
  }
  row.append(bubble);
  return row;
}

export function renderMessages(messages, pending, options) {
  const host = emptyNode(element("messages"));
  const rows = [
    ...messages.map((message) => messageNode(message, options)),
    ...pending.map((item) => pendingNode(item, options.onRetry)),
  ];
  if (!rows.length) host.append(textNode("p", "empty", "Nach keng Noriichten an dësem Chat."));
  else host.append(...rows);
  host.scrollTop = host.scrollHeight;
}

export function renderMessagesLoading() {
  emptyNode(element("messages")).append(textNode("p", "empty", "Noriichte gi gelueden…"));
}

export function highlightMessage(remoteId) {
  if (!remoteId) return;
  const rows = [...element("messages").querySelectorAll("[data-remote-id]")];
  const match = rows.find((row) => row.dataset.remoteId === remoteId);
  if (!match) {
    showNotice("Déi fonnten Noriicht läit ausserhalb vun de geluedene Noriichten.", "info");
    return;
  }
  match.classList.add("highlight");
  match.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => match.classList.remove("highlight"), SECOND_MS);
}
