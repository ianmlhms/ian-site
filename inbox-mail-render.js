import { relativeTime } from "./inbox-render.js?v=3";

const PROVIDER_ICONS = Object.freeze({
  m365: "🏢",
  google: "📧",
  icloud: "☁️",
  other: "✉️",
});
const BYTES_PER_KB = 1024;

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

export function accountLabel(account) {
  if (!account) return "✉️ Mail";
  return `${PROVIDER_ICONS[account.provider] || "✉️"} ${account.label}`;
}

function senderLabel(message) {
  if (message.is_from_me) {
    const to = (message.to_addrs || [])[0];
    return to ? `un ${to}` : "un mech";
  }
  return message.from_name || message.from_addr || "Onbekannt";
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < BYTES_PER_KB) return `${bytes} B`;
  const kb = bytes / BYTES_PER_KB;
  if (kb < BYTES_PER_KB) return `${Math.round(kb)} kB`;
  return `${(kb / BYTES_PER_KB).toFixed(1)} MB`;
}

export function renderMailList(messages, selectedId, onSelect, accountsById) {
  const list = emptyNode(element("chatList"));
  if (!messages.length) {
    list.append(textNode("li", "empty",
      "Keng Mailen an dësem Filter. Leeft de Mail-Bridge scho?"));
    return;
  }
  messages.forEach((message) => {
    list.append(mailRow(message, selectedId, onSelect, accountsById));
  });
}

function mailRow(message, selectedId, onSelect, accountsById) {
  const item = document.createElement("li");
  const classes = ["chat-row", "mail-row"];
  if (!message.is_read && !message.is_from_me) classes.push("unread");
  if (message.id === selectedId) classes.push("active");
  item.className = classes.join(" ");

  const button = document.createElement("button");
  button.type = "button";
  button.onclick = () => onSelect(message.id);

  const top = textNode("span", "chat-row-top", "");
  top.append(
    textNode("span", "chat-title", senderLabel(message)),
    textNode("time", "chat-time", relativeTime(message.sent_at)),
  );

  const subjectRow = textNode("span", "chat-row-bottom", "");
  subjectRow.append(
    textNode("span", "mail-account-badge",
      accountLabel(accountsById[message.account_id])),
    textNode("span", "mail-subject", message.subject || "(Keen Betreff)"),
  );

  const bottom = textNode("span", "chat-row-bottom", "");
  bottom.append(textNode("span", "chat-preview", message.snippet || "Keng Virschau"));
  if (message.has_attachments) bottom.append(textNode("span", "mail-clip", "📎"));
  if (message.is_bulk) bottom.append(textNode("span", "mail-tag", "Newsletter"));

  const texts = document.createElement("span");
  texts.className = "chat-row-texts";
  texts.append(top, subjectRow, bottom);
  button.append(texts);
  item.append(button);
  return item;
}

export function renderMailHeader(message, account, onBack) {
  const head = emptyNode(element("chatHead"));
  if (!message) {
    head.append(textNode("span", "", "Wiel eng Mail aus ←"));
    return;
  }
  const back = textNode("button", "back-btn", "‹");
  back.type = "button";
  back.onclick = onBack;
  const labels = document.createElement("div");
  labels.className = "chat-head-labels";
  labels.append(
    textNode("strong", "", message.subject || "(Keen Betreff)"),
    textNode("small", "", `${senderLabel(message)} · ${accountLabel(account)}`),
  );
  head.append(back, labels);
}

function addressLine(label, addresses) {
  const values = (addresses || []).filter(Boolean);
  if (!values.length) return null;
  return textNode("p", "mail-addr", `${label}: ${values.join(", ")}`);
}

function attachmentChip(attachment) {
  const parts = [attachment.filename || "Unhang"];
  const size = formatSize(attachment.size_bytes);
  if (size) parts.push(size);
  const chip = textNode("span", "media-chip", `📎 ${parts.join(" · ")}`);
  chip.title = attachment.mime_type || "";
  return chip;
}

function htmlLink(message, createBodyUrl, onError) {
  const button = textNode("button", "media-chip available", "🌐 Original opmaachen");
  button.type = "button";
  button.onclick = async () => {
    button.disabled = true;
    try {
      window.open(await createBodyUrl(message.body_html_path), "_blank", "noopener");
    } catch (error) {
      onError(error);
    } finally {
      button.disabled = false;
    }
  };
  return button;
}

function mailCard(message, options) {
  const card = document.createElement("article");
  card.className = `mail-card${message.is_from_me ? " mine" : ""}`;

  const head = document.createElement("div");
  head.className = "mail-card-head";
  head.append(
    textNode("strong", "", senderLabel(message)),
    textNode("time", "chat-time", new Date(message.sent_at).toLocaleString("lb-LU")),
  );
  card.append(head);

  const to = addressLine("Un", message.to_addrs);
  if (to) card.append(to);
  const cc = addressLine("Cc", message.cc_addrs);
  if (cc) card.append(cc);

  card.append(textNode("pre", "mail-body", message.body_text || "(Keen Text an dëser Mail)"));

  const tools = document.createElement("div");
  tools.className = "media-host";
  if (message.body_html_path) {
    tools.append(htmlLink(message, options.createBodyUrl, options.onError));
  }
  (options.attachments || []).forEach((attachment) => tools.append(attachmentChip(attachment)));
  if (tools.childElementCount) card.append(tools);
  return card;
}

export function renderMailBody(message, thread, options) {
  const host = emptyNode(element("messages"));
  if (!message) {
    host.append(textNode("p", "empty", "Wiel eng Mail aus."));
    return;
  }
  const conversation = thread.length ? thread : [message];
  conversation.forEach((entry) => {
    host.append(mailCard(entry, {
      ...options,
      attachments: entry.id === message.id ? options.attachments : [],
    }));
  });
  host.scrollTop = host.scrollHeight;
}

export function renderMailLoading() {
  emptyNode(element("messages")).append(textNode("p", "empty", "Mail gëtt gelueden…"));
}

export function renderMailAccounts(accounts) {
  const strip = emptyNode(element("mailStrip"));
  if (!accounts.length) {
    strip.append(textNode("span", "empty", "Keng Mail-Kontoen konfiguréiert."));
    return;
  }
  accounts.forEach((account) => {
    const state = account.status === "online" ? "fresh" : "missing";
    const item = document.createElement("div");
    item.className = `account-state ${state}`;
    item.append(
      textNode("span", "account-heading", accountLabel(account)),
      textNode("span", "account-status", account.status || "—"),
      textNode("span", "account-seen", account.last_seen_at
        ? relativeTime(account.last_seen_at) : "nach ni"),
    );
    if (account.error) item.append(textNode("span", "account-error", account.error));
    strip.append(item);
  });
}
