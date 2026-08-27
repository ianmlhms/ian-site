import { client, session, onAuth } from './auth.js';
import { mountAccountButton, openAuthModal } from "./auth.js";
import {
  createMediaUrl,
  fetchAccounts,
  fetchChats,
  fetchMessages,
  queueMediaRequest,
  queueOutbox,
  searchMessages,
  subscribeToBridge,
} from "./inbox-data.js?v=1";
import {
  highlightMessage,
  renderAccounts,
  renderChatHeader,
  renderChatList,
  renderGate,
  renderMessages,
  renderMessagesLoading,
  renderSearchResults,
  showNotice,
} from "./inbox-render.js?v=1";

const SEARCH_DELAY_MS = 300;
const ACCOUNT_REFRESH_MS = 30 * 1000;
const PENDING_MATCH_WINDOW_MS = 2 * 60 * 1000;
const REALTIME_NOTICE_MS = 2500;
const REALTIME_ERROR_STATES = Object.freeze(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

let state = Object.freeze({
  accounts: [],
  chats: [],
  filter: "all",
  messages: [],
  pending: [],
  searchResults: [],
  searchTerm: "",
  selectedChatId: null,
});
let bridgeChannel = null;
let searchTimer = null;
let accountTimer = null;
let noticeTimer = null;

function setState(patch) {
  state = Object.freeze({ ...state, ...patch });
}

function currentChat() {
  return state.chats.find((chat) => chat.id === state.selectedChatId) || null;
}

function chatsById() {
  return Object.fromEntries(state.chats.map((chat) => [chat.id, chat]));
}

function filteredChats() {
  if (state.filter === "all") return state.chats;
  return state.chats.filter((chat) => chat.service === state.filter);
}

function renderSidebar() {
  if (state.searchTerm) {
    renderSearchResults(state.searchResults, chatsById(), selectChat);
    return;
  }
  renderChatList(filteredChats(), state.selectedChatId, selectChat);
}

function showError(error) {
  const message = error instanceof Error ? error.message : "En onbekannte Feeler ass geschitt.";
  showNotice(message, "error");
}

function pendingForCurrentChat() {
  return state.pending.filter((item) => item.chatId === state.selectedChatId);
}

function renderConversation() {
  renderChatHeader(currentChat(), closeMobileChat);
  renderMessages(state.messages, pendingForCurrentChat(), {
    createMediaUrl: (path) => createMediaUrl(supabase, path),
    onError: showError,
    onMediaRequest: requestMedia,
    onRetry: retryPending,
  });
}

function setFilter(service) {
  setState({ filter: service });
  document.querySelectorAll("[data-service-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.serviceFilter === service);
  });
  renderSidebar();
}

function closeMobileChat() {
  document.getElementById("app").classList.remove("chat-open");
}

async function selectChat(chatId, remoteId = null) {
  const chat = state.chats.find((entry) => entry.id === chatId);
  if (!chat) {
    showNotice("Dëse Chat ass net méi verfügbar.", "error");
    return;
  }
  setState({ messages: [], selectedChatId: chatId });
  renderSidebar();
  renderChatHeader(chat, closeMobileChat);
  renderMessagesLoading();
  document.getElementById("app").classList.add("chat-open");
  document.getElementById("composer").hidden = false;
  try {
    const messages = await fetchMessages(supabase, chatId);
    if (state.selectedChatId !== chatId) return;
    setState({ messages });
    renderConversation();
    highlightMessage(remoteId);
  } catch (error) {
    if (state.selectedChatId !== chatId) return;
    setState({ messages: [] });
    renderConversation();
    showError(error);
  }
}

function createPending(chat, body) {
  return Object.freeze({
    body,
    chatId: chat.id,
    createdAt: new Date().toISOString(),
    error: null,
    localId: crypto.randomUUID(),
    outboxId: null,
    sentRemoteId: null,
    status: "queued",
  });
}

function replacePending(localId, patch) {
  const pending = state.pending.map((item) => item.localId === localId
    ? Object.freeze({ ...item, ...patch })
    : item);
  setState({ pending });
  renderConversation();
}

async function enqueuePending(pending, chat) {
  try {
    const outbox = await queueOutbox(supabase, chat, pending.body);
    replacePending(pending.localId, {
      error: outbox.error,
      outboxId: outbox.id,
      sentRemoteId: outbox.sent_remote_id,
      status: outbox.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "D'Noriicht konnt net geschéckt ginn.";
    replacePending(pending.localId, { error: message, status: "failed" });
    showError(error);
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const input = document.getElementById("messageInput");
  const body = input.value.trim();
  const chat = currentChat();
  if (!chat || !body) return;
  input.value = "";
  const pending = createPending(chat, body);
  setState({ pending: [...state.pending, pending] });
  renderConversation();
  void enqueuePending(pending, chat);
}

function retryPending(localId) {
  const pending = state.pending.find((item) => item.localId === localId);
  const chat = state.chats.find((item) => item.id === pending?.chatId);
  if (!pending || !chat) {
    showNotice("D'Noriicht kann net nach eng Kéier geschéckt ginn.", "error");
    return;
  }
  replacePending(localId, { error: null, outboxId: null, sentRemoteId: null, status: "queued" });
  void enqueuePending(Object.freeze({ ...pending, error: null, status: "queued" }), chat);
}

async function requestMedia(messageId) {
  const message = state.messages.find((entry) => entry.id === messageId);
  if (!message || message.media_state !== "none") return;
  const messages = state.messages.map((entry) => entry.id === messageId
    ? Object.freeze({ ...entry, media_state: "requested" })
    : entry);
  setState({ messages });
  renderConversation();
  try {
    await queueMediaRequest(supabase, messageId);
  } catch (error) {
    const reverted = state.messages.map((entry) => entry.id === messageId
      ? Object.freeze({ ...entry, media_state: "none" })
      : entry);
    setState({ messages: reverted });
    renderConversation();
    showError(error);
  }
}

function sortedChats(chats) {
  return [...chats].sort((left, right) => {
    const rightTime = new Date(right.last_at || 0).getTime();
    const leftTime = new Date(left.last_at || 0).getTime();
    return rightTime - leftTime;
  });
}

function sortedMessages(messages) {
  return [...messages].sort((left, right) => {
    const leftTime = new Date(left.sent_at || 0).getTime();
    const rightTime = new Date(right.sent_at || 0).getTime();
    return leftTime - rightTime;
  });
}

function upsertById(items, incoming) {
  const hasItem = items.some((item) => item.id === incoming.id);
  if (!hasItem) return [...items, incoming];
  return items.map((item) => item.id === incoming.id ? Object.freeze({ ...item, ...incoming }) : item);
}

function onChatUpdate(chat) {
  setState({ chats: sortedChats(upsertById(state.chats, chat)) });
  renderSidebar();
  if (chat.id === state.selectedChatId) renderChatHeader(currentChat(), closeMobileChat);
}

function matchesPending(message, pending) {
  if (pending.chatId !== message.chat_id || pending.body !== message.body) return false;
  if (pending.sentRemoteId && pending.sentRemoteId === message.remote_id) return true;
  const sentAt = new Date(message.sent_at).getTime();
  const queuedAt = new Date(pending.createdAt).getTime();
  return Math.abs(sentAt - queuedAt) <= PENDING_MATCH_WINDOW_MS;
}

function onMessageInsert(message) {
  const matched = message.is_from_me
    ? state.pending.find((pending) => matchesPending(message, pending))
    : null;
  const pending = matched
    ? state.pending.filter((item) => item.localId !== matched.localId)
    : state.pending;
  const messages = message.chat_id === state.selectedChatId
    ? sortedMessages(upsertById(state.messages, message))
    : state.messages;
  setState({ messages, pending });
  if (message.chat_id === state.selectedChatId) renderConversation();
}

function onMessageUpdate(message) {
  if (message.chat_id !== state.selectedChatId) return;
  setState({ messages: sortedMessages(upsertById(state.messages, message)) });
  renderConversation();
}

function onOutboxUpdate(outbox) {
  const pending = state.pending.map((item) => item.outboxId === outbox.id
    ? Object.freeze({
      ...item,
      error: outbox.error,
      sentRemoteId: outbox.sent_remote_id,
      status: outbox.status,
    })
    : item);
  setState({ pending });
  if (outbox.chat_id === state.selectedChatId) renderConversation();
}

function onAccountUpdate(account) {
  setState({ accounts: upsertById(state.accounts, account) });
  renderAccounts(state.accounts);
}

function onRealtimeStatus(status) {
  if (status === "SUBSCRIBED") {
    showNotice("Live-Verbindung aktiv.", "success");
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => showNotice(""), REALTIME_NOTICE_MS);
    return;
  }
  if (REALTIME_ERROR_STATES.includes(status)) {
    showNotice("D'Live-Verbindung ass ënnerbrach. D'Donnéeë kënnen al sinn.", "error");
  }
}

async function runSearch(term) {
  try {
    const searchResults = await searchMessages(supabase, term);
    if (state.searchTerm !== term) return;
    setState({ searchResults });
    renderSidebar();
  } catch (error) {
    if (state.searchTerm !== term) return;
    setState({ searchResults: [] });
    renderSidebar();
    showError(error);
  }
}

function onSearchInput(event) {
  const searchTerm = event.target.value.trim();
  window.clearTimeout(searchTimer);
  setState({ searchResults: [], searchTerm });
  renderSidebar();
  if (!searchTerm) return;
  searchTimer = window.setTimeout(() => void runSearch(searchTerm), SEARCH_DELAY_MS);
}

function stopAuthenticatedApp() {
  if (bridgeChannel) void supabase.removeChannel(bridgeChannel);
  bridgeChannel = null;
  window.clearInterval(accountTimer);
  accountTimer = null;
  window.clearTimeout(searchTimer);
  setState({
    accounts: [],
    chats: [],
    filter: "all",
    messages: [],
    pending: [],
    searchResults: [],
    searchTerm: "",
    selectedChatId: null,
  });
  document.getElementById("app").classList.remove("chat-open");
  document.getElementById("composer").hidden = true;
  document.getElementById("searchInput").value = "";
  renderGate(true, openAuthModal);
}

async function startAuthenticatedApp() {
  const activeSession = session();
  if (!activeSession) {
    stopAuthenticatedApp();
    return;
  }
  renderGate(false, openAuthModal);
  if (!accountTimer) {
    accountTimer = window.setInterval(() => {
      renderAccounts(state.accounts);
      renderSidebar();
    }, ACCOUNT_REFRESH_MS);
  }
  try {
    const [chats, accounts] = await Promise.all([
      fetchChats(supabase),
      fetchAccounts(supabase),
    ]);
    setState({ accounts, chats: sortedChats(chats) });
    renderAccounts(state.accounts);
    renderSidebar();
    renderChatHeader(null, closeMobileChat);
    subscribe(activeSession.user.id);
    openChatFromUrl();
  } catch (error) {
    showError(error);
  }
}

function subscribe(userId) {
  if (bridgeChannel) void supabase.removeChannel(bridgeChannel);
  bridgeChannel = subscribeToBridge(supabase, userId, {
    onAccountUpdate,
    onChatUpdate,
    onMessageInsert,
    onMessageUpdate,
    onOutboxUpdate,
    onStatus: onRealtimeStatus,
  });
}

function openChatFromUrl() {
  const chatId = Number(new URLSearchParams(location.search).get("chat"));
  if (!Number.isInteger(chatId) || chatId <= 0) return;
  void selectChat(chatId);
}

function bindUi() {
  mountAccountButton(document.getElementById("acctHost"));
  document.getElementById("composer").addEventListener("submit", sendMessage);
  document.getElementById("searchInput").addEventListener("input", onSearchInput);
  document.querySelectorAll("[data-service-filter]").forEach((button) => {
    button.addEventListener("click", () => setFilter(button.dataset.serviceFilter));
  });
}

let clientError = null;
const supabase = await client().catch((error) => {
  clientError = error;
  return null;
});
if (supabase) {
  bindUi();
  onAuth((activeSession) => {
    if (activeSession) void startAuthenticatedApp();
    else stopAuthenticatedApp();
  });
  await startAuthenticatedApp();
} else {
  renderGate(true, openAuthModal);
  showError(new Error(`D'Verbindung mam Login ass feelgeschloen. ${clientError?.message || ""}`.trim()));
}
