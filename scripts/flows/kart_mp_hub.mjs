/* A tiny in-process Supabase Realtime server (Phoenix protocol v2: join, broadcast, presence) shared by several browser
 * contexts, so a multiplayer test can run lobby + signalling for real without touching the live project.
 * It also counts every frame (client -> server and server -> client, heartbeats separate) for the egress budget test. */

function decodeBinaryPush(buffer) {
  const bytes = Buffer.from(buffer);
  if (bytes[0] !== 3) return null;
  const [joinRefLen, refLen, topicLen, eventLen, metaLen] = [bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]];
  let at = 7;
  const take = (len) => { const text = bytes.subarray(at, at + len).toString("utf8"); at += len; return text; };
  const joinRef = take(joinRefLen) || null;
  const ref = take(refLen) || null;
  const topic = take(topicLen);
  const event = take(eventLen);
  take(metaLen);
  const payload = bytes[6] === 1 ? JSON.parse(bytes.subarray(at).toString("utf8")) : null;
  return [joinRef, ref, topic, "broadcast", { type: "broadcast", event, payload }];
}

export function createHub() {
  const topics = new Map();      // topic -> Map(conn -> { joinRef, key, meta, ref })
  const stats = { framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0, heartbeats: 0, byEvent: {}, perContext: {}, joins: 0, tracks: 0, broadcasts: 0, log: [] };
  let refSeq = 0;
  const conns = new Set();

  const bump = (name) => { stats.byEvent[name] = (stats.byEvent[name] || 0) + 1; };
  function out(conn, joinRef, ref, topic, event, payload, heartbeat) {
    const text = JSON.stringify([joinRef, ref, topic, event, payload]);
    if (heartbeat) { stats.heartbeatReplies = (stats.heartbeatReplies || 0) + 1; try { conn.ws.send(text); } catch { /* socket closed */ } return; }      // keep-alive replies are not messages (not billed, not counted)
    stats.framesOut++; stats.bytesOut += text.length; bump('out:' + event);
    const pc = (stats.perContext[conn.label] ||= { in: 0, out: 0, bytesIn: 0, bytesOut: 0 }); pc.out++; pc.bytesOut += text.length;
    try { conn.ws.send(text); } catch { /* socket closed */ }
  }
  const members = (topic) => topics.get(topic) || new Map();
  const presenceOf = (topic, except) => {
    const all = {};
    for (const [c, m] of members(topic)) {
      if (c === except || !m.meta) continue;
      all[m.key] = { metas: [{ phx_ref: m.ref, ...m.meta }] };
    }
    return all;
  };
  function diff(topic, joins, leaves) {
    for (const [c, m] of members(topic)) out(c, m.joinRef, null, topic, 'presence_diff', { joins, leaves });
  }
  function leaveTopic(conn, topic) {
    const mem = topics.get(topic); if (!mem) return;
    const m = mem.get(conn); if (!m) return;
    mem.delete(conn);
    if (m.meta) diff(topic, {}, { [m.key]: { metas: [{ phx_ref: m.ref, ...m.meta }] } });
    if (!mem.size) topics.delete(topic);
  }

  async function attach(context, label) {
    await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      const conn = { ws, label };
      conns.add(conn);
      const pc = (stats.perContext[label] ||= { in: 0, out: 0, bytesIn: 0, bytesOut: 0 });
      ws.onClose(() => { conns.delete(conn); for (const t of [...topics.keys()]) leaveTopic(conn, t); });
      ws.onMessage((message) => {
        let frame;
        const size = typeof message === 'string' ? message.length : message.length;
        try { frame = typeof message === 'string' ? JSON.parse(message) : decodeBinaryPush(message); } catch { return; }
        if (!Array.isArray(frame)) return;
        const [joinRef, ref, topic, event, payload] = frame;
        if (event === 'heartbeat') { stats.heartbeats++; ref && out(conn, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }, true); return; }
        stats.framesIn++; stats.bytesIn += size; pc.in++; pc.bytesIn += size; bump('in:' + event + (event === 'broadcast' ? ':' + (payload && payload.event) : ''));
        const reply = (response = {}) => ref && out(conn, joinRef, ref, topic, 'phx_reply', { status: 'ok', response });
        if (event === 'phx_join') {
          stats.joins++;
          const cfg = payload?.config || {};
          const mem = topics.get(topic) || new Map(); topics.set(topic, mem);
          mem.set(conn, { joinRef, key: cfg.presence?.key || ('k' + (++refSeq)), meta: null, ref: 'r' + (++refSeq), ack: !!cfg.broadcast?.ack });
          reply({ postgres_changes: [] });
          out(conn, joinRef, null, topic, 'presence_state', presenceOf(topic, conn));
        } else if (event === 'presence') {
          const m = members(topic).get(conn);
          if (m && payload?.event === 'track') {
            stats.tracks++;
            const old = m.meta ? { [m.key]: { metas: [{ phx_ref: m.ref, ...m.meta }] } } : {};
            m.meta = payload.payload || {}; m.ref = 'r' + (++refSeq);
            diff(topic, { [m.key]: { metas: [{ phx_ref: m.ref, ...m.meta }] } }, old);
          } else if (m && payload?.event === 'untrack' && m.meta) {
            const old = { [m.key]: { metas: [{ phx_ref: m.ref, ...m.meta }] } }; m.meta = null; diff(topic, {}, old);
          }
          reply();
        } else if (event === 'broadcast') {
          stats.broadcasts++;
          const text = payload;
          for (const [c, m] of members(topic)) {
            if (c === conn) continue;
            out(c, m.joinRef, null, topic, 'broadcast', { type: 'broadcast', event: text?.event, payload: text?.payload });
          }
          if (members(topic).get(conn)?.ack) reply();        // like the real server: broadcasts are only acknowledged when asked for
        } else if (event === 'phx_leave') {
          leaveTopic(conn, topic); reply();
        } else reply();
      });
    });
  }
  return { attach, stats, topics, reset() { for (const k of Object.keys(stats)) delete stats[k]; Object.assign(stats, { framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0, heartbeats: 0, byEvent: {}, perContext: {}, joins: 0, tracks: 0, broadcasts: 0, log: [] }); } };
}
