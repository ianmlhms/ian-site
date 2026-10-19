/* A tiny in-process Supabase Realtime server (Phoenix protocol v2) shared by several browser contexts, for the lobby flows.
 * Join, broadcast and presence work like the real thing; on top of kart_mp_hub.mjs it also
 *   - knows WHO each context is (attach(context, label, uid)), and
 *   - delivers postgres_changes INSERT events (hub.pushInsert) so the invite toast path (game_invites → notify.js) runs for real.
 * Every frame is counted (heartbeats apart), per context, so a flow can report the realtime cost of a lobby session. */

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

const freshStats = () => ({ framesIn: 0, framesOut: 0, bytesIn: 0, bytesOut: 0, heartbeats: 0, byEvent: {}, perContext: {}, joins: 0, tracks: 0, broadcasts: 0, topicsSeen: [] });

export function createHub() {
  const topics = new Map();      // topic -> Map(conn -> { joinRef, key, meta, ref, pg })
  let stats = freshStats();
  let refSeq = 0, pgSeq = 0;
  const conns = new Set();
  const bump = (name) => { stats.byEvent[name] = (stats.byEvent[name] || 0) + 1; };
  const pc = (label) => (stats.perContext[label] ||= { in: 0, out: 0, bytesIn: 0, bytesOut: 0 });

  function out(conn, joinRef, ref, topic, event, payload) {
    const text = JSON.stringify([joinRef, ref, topic, event, payload]);
    stats.framesOut++; stats.bytesOut += text.length; bump("out:" + event);
    const c = pc(conn.label); c.out++; c.bytesOut += text.length;
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
    for (const [c, m] of members(topic)) out(c, m.joinRef, null, topic, "presence_diff", { joins, leaves });
  }
  function leaveTopic(conn, topic) {
    const mem = topics.get(topic); if (!mem) return;
    const m = mem.get(conn); if (!m) return;
    mem.delete(conn);
    if (m.meta) diff(topic, {}, { [m.key]: { metas: [{ phx_ref: m.ref, ...m.meta }] } });
    if (!mem.size) topics.delete(topic);
  }

  async function attach(context, label, uid = "") {
    await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      const conn = { ws, label, uid };
      conns.add(conn);
      pc(label);
      ws.onClose(() => { conns.delete(conn); for (const t of [...topics.keys()]) leaveTopic(conn, t); });
      ws.onMessage((message) => {
        let frame;
        const size = message.length;
        try { frame = typeof message === "string" ? JSON.parse(message) : decodeBinaryPush(message); } catch { return; }
        if (!Array.isArray(frame)) return;
        const [joinRef, ref, topic, event, payload] = frame;
        if (event === "heartbeat") { stats.heartbeats++; ref && out(conn, joinRef, ref, topic, "phx_reply", { status: "ok", response: {} }); return; }
        stats.framesIn++; stats.bytesIn += size; const c = pc(label); c.in++; c.bytesIn += size;
        bump("in:" + event + (event === "broadcast" ? ":" + (payload && payload.event) : ""));
        const reply = (response = {}) => ref && out(conn, joinRef, ref, topic, "phx_reply", { status: "ok", response });
        if (event === "phx_join") {
          stats.joins++;
          if (!stats.topicsSeen.includes(topic)) stats.topicsSeen.push(topic);
          const cfg = payload?.config || {};
          const mem = topics.get(topic) || new Map(); topics.set(topic, mem);
          const pg = (cfg.postgres_changes || []).map((p) => ({ id: ++pgSeq, event: p.event, schema: p.schema, table: p.table, filter: p.filter }));
          mem.set(conn, { joinRef, key: cfg.presence?.key || ("k" + (++refSeq)), meta: null, ref: "r" + (++refSeq), ack: !!cfg.broadcast?.ack, pg });
          reply({ postgres_changes: pg });
          out(conn, joinRef, null, topic, "presence_state", presenceOf(topic, conn));
        } else if (event === "presence") {
          const m = members(topic).get(conn);
          if (m && payload?.event === "track") {
            stats.tracks++;
            const old = m.meta ? { [m.key]: { metas: [{ phx_ref: m.ref, ...m.meta }] } } : {};
            m.meta = payload.payload || {}; m.ref = "r" + (++refSeq);
            diff(topic, { [m.key]: { metas: [{ phx_ref: m.ref, ...m.meta }] } }, old);
          } else if (m && payload?.event === "untrack" && m.meta) {
            const old = { [m.key]: { metas: [{ phx_ref: m.ref, ...m.meta }] } }; m.meta = null; diff(topic, {}, old);
          }
          reply();
        } else if (event === "broadcast") {
          stats.broadcasts++;
          for (const [other, m] of members(topic)) {
            if (other === conn) continue;
            out(other, m.joinRef, null, topic, "broadcast", { type: "broadcast", event: payload?.event, payload: payload?.payload });
          }
          if (members(topic).get(conn)?.ack) reply();
        } else if (event === "phx_leave") {
          leaveTopic(conn, topic); reply();
        } else reply();
      });
    });
  }

  /* what the database would send after an INSERT into `table` that is visible to user `toUid` (filter to_user=eq.<uid>) */
  function pushInsert(table, record, toUid) {
    let delivered = 0;
    for (const [topic, mem] of topics) {
      for (const [conn, m] of mem) {
        if (conn.uid !== toUid) continue;
        const ids = m.pg.filter((p) => p.table === table && (!p.filter || p.filter === `to_user=eq.${toUid}`)).map((p) => p.id);
        if (!ids.length) continue;
        out(conn, m.joinRef, null, topic, "postgres_changes", {
          ids, data: { schema: "public", table, commit_timestamp: new Date().toISOString(), type: "INSERT", columns: [], record, old_record: {}, errors: null },
        });
        delivered++;
      }
    }
    return delivered;
  }

  return {
    attach, pushInsert, topics, get stats() { return stats; }, reset() { stats = freshStats(); },
    presenceCount: (topic) => [...members(topic).values()].filter((m) => m.meta).length,
  };
}
