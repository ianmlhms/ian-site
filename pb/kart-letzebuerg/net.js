/* Kart Lëtzebuerg — transport for online play: WebRTC data-channel links (one reliable "ev", one unreliable "st" channel)
 * and the capped Supabase-Realtime relay used only when WebRTC cannot connect. No game logic in here.
 * Hand-shake is NON-trickle: one offer and one answer per pair (ICE candidates are inside the SDP), to keep Realtime traffic tiny. */
(function () {
  'use strict';
  const KL = window.KL, N = KL.NET;
  const NetStats = (KL.netStats = { relayMsgs: 0, relayIn: 0, relayDropped: 0, rtcSent: 0, rtcRecv: 0, rtcBytesSent: 0, rtcBytesRecv: 0, links: 0 });
  const log = (...a) => { if (KL.NET_DEBUG) console.info('[kart-net]', ...a); };

  class Link {
    /* o: { peerId, initiator, signal(type, data), onmessage(msg, reliable), onopen(), onclose(reason) } */
    constructor(o) {
      Object.assign(this, { id: o.peerId, kind: 'rtc', open: false, closed: false, initiator: !!o.initiator, signal: o.signal, onmessage: o.onmessage, onopen: o.onopen, onclose: o.onclose });
      this.ev = null; this.st = null; this.rtt = null; this.lastRecv = performance.now(); this.born = performance.now();
      NetStats.links++;
      const pc = (this.pc = new RTCPeerConnection({ iceServers: N.ICE_SERVERS }));
      pc.onconnectionstatechange = () => {
        log(this.id, 'connection', pc.connectionState);
        if (pc.connectionState === 'failed') this.close('failed');
        else if (pc.connectionState === 'disconnected') { clearTimeout(this._dc); this._dc = setTimeout(() => { if (pc.connectionState !== 'connected') this.close('disconnected'); }, N.LINK_GRACE); }
      };
      if (this.initiator) {
        this._wire(pc.createDataChannel('ev', { ordered: true }), true);
        this._wire(pc.createDataChannel('st', { ordered: false, maxRetransmits: 0 }), false);
      } else {
        pc.ondatachannel = (e) => this._wire(e.channel, e.channel.label === 'ev');
      }
      this._timeout = setTimeout(() => { if (!this.open) this.close('timeout'); }, N.CONNECT_TIMEOUT);
    }

    _wire(ch, reliable) {
      if (reliable) this.ev = ch; else this.st = ch;
      ch.onopen = () => this._check();
      ch.onclose = () => { if (this.open) this.close('channel'); };
      ch.onerror = () => {};
      ch.onmessage = (e) => {
        this.lastRecv = performance.now();
        NetStats.rtcRecv++; NetStats.rtcBytesRecv += e.data.length;
        let m; try { m = JSON.parse(e.data); } catch (err) { return; }
        if (m && typeof m === 'object' && this.onmessage) this.onmessage(m, reliable);
      };
    }
    _check() {
      if (this.open || this.closed) return;
      if (this.ev && this.ev.readyState === 'open' && this.st && this.st.readyState === 'open') {
        this.open = true; clearTimeout(this._timeout); this.openedAt = performance.now();
        log(this.id, 'open after', Math.round(this.openedAt - this.born), 'ms');
        if (this.onopen) this.onopen();
      }
    }

    _gathered() {
      const pc = this.pc;
      return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') return resolve();
        const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', chk); resolve(); };
        const chk = () => { if (pc.iceGatheringState === 'complete') done(); };
        const t = setTimeout(done, N.ICE_GATHER_MS);
        pc.addEventListener('icegatheringstatechange', chk);
      });
    }
    async makeOffer() {
      try {
        await this.pc.setLocalDescription(await this.pc.createOffer());
        await this._gathered();
        this.signal('offer', this.pc.localDescription.sdp);
      } catch (e) { console.warn('[kart-net] offer failed', e); this.close('offer'); }
    }
    async acceptOffer(sdp) {
      try {
        await this.pc.setRemoteDescription({ type: 'offer', sdp });
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        await this._gathered();
        this.signal('answer', this.pc.localDescription.sdp);
      } catch (e) { console.warn('[kart-net] answer failed', e); this.close('answer'); }
    }
    async acceptAnswer(sdp) {
      try { await this.pc.setRemoteDescription({ type: 'answer', sdp }); } catch (e) { console.warn('[kart-net] bad answer', e); this.close('answer'); }
    }

    send(msg, reliable) {
      const ch = reliable === false ? this.st : this.ev;
      if (this.closed || !ch || ch.readyState !== 'open') return false;
      if (reliable === false && ch.bufferedAmount > 65536) return false;      // congested: drop the (replaceable) state packet
      const s = typeof msg === 'string' ? msg : JSON.stringify(msg);
      try { ch.send(s); } catch (e) { return false; }
      NetStats.rtcSent++; NetStats.rtcBytesSent += s.length;
      return true;
    }
    close(reason) {
      if (this.closed) return;
      this.closed = true; const was = this.open; this.open = false;
      clearTimeout(this._timeout); clearTimeout(this._dc);
      try { this.ev && this.ev.close(); this.st && this.st.close(); this.pc.close(); } catch (e) { /* already closed */ }
      log(this.id, 'closed', reason);
      if (this.onclose) this.onclose(reason || 'closed', was);
    }
  }

  /* Relay over a Supabase-Realtime channel for ONE peer that has no WebRTC path (a channel with exactly two members: the host and that peer).
   * In a race the traffic is shaped to stay cheap and never be a reason to lose a player:
   *  - kart states are sampled at RELAY_HZ * RELAY_BATCH per second and leave RELAY_BATCH at a time in one message (RELAY_HZ messages/s),
   *  - reliable messages (events, item uses, ...) are not sent on their own but ride along with the next state message,
   *  - a per-race message budget lowers the rate step by step when it runs low (RELAY_SLOW) and, only when it is completely used up, ends THIS
   *    peer's relay with an explicit 'bye' (reason 'budget') that both sides show to the player.
   * Outside a race (lobby, hand-shake) every message is sent at once. */
  const IMMEDIATE = new Set(['leave', 'hostleave', 'hostaway', 'hostback', 'away', 'back', 'closed']);
  const raceNow = () => { const M = KL.MP; return !!(M && M.active && !M.ended && M.R && !M.R.hold); };
  class RelayLink {
    /* o: { peerId, myId, open, send(payload), onmessage(msg, reliable), onopen(), onclose(reason), dispose() } */
    constructor(o) {
      Object.assign(this, { id: o.peerId, kind: 'relay', open: o.open !== false, closed: false, myId: o.myId, tx: o.send, onmessage: o.onmessage, onopen: o.onopen, onclose: o.onclose, dispose: o.dispose, rtt: null, lastRecv: performance.now(), born: performance.now() });
      this.mode = 'lobby'; this.count = 0; this.total = 0; this.recv = 0; this.raceSent = 0;
      this.q = []; this.st = []; this.lastAccept = 0; this.timer = 0; this.level = 0;
    }
    _mode() {
      const m = raceNow() ? 'race' : 'lobby';
      if (m !== this.mode) { this._flush(); this.mode = m; this.count = 0; this.level = 0; this.st = []; this.lastAccept = 0; }
      return m;
    }
    budget() { return this.mode === 'race' ? N.RELAY_RACE_MSGS : N.RELAY_LOBBY_MSGS; }
    /* current messages/s: the nominal rate, lowered when the budget of this race runs low */
    hz() {
      const frac = this.count / this.budget(); let hz = N.RELAY_HZ;
      for (const [f, h] of N.RELAY_SLOW) if (frac >= f) hz = Math.min(hz, h);
      return hz;
    }
    _out(msg) {
      if (this.closed) return false;
      if (this.count >= this.budget()) { this._bye('budget'); return false; }
      this.count++; this.total++; if (this.mode === 'race') this.raceSent++;
      NetStats.relayMsgs++;
      if (this.count === Math.floor(this.budget() * 0.6) || this.count === Math.floor(this.budget() * 0.85)) console.warn('[kart-net] relay budget for ' + this.id + ': ' + this.count + '/' + this.budget() + ' messages, rate lowered');
      this.tx(msg);
      return true;
    }
    _bye(why) {
      if (this.closed) return;
      console.warn('[kart-net] relay budget of ' + this.id + ' used up (' + why + ')');
      try { this.tx({ k: 'bye', why }); } catch (e) { /* closing */ }
      this.close(why);
    }
    _flush() {
      clearTimeout(this.timer); this.timer = 0;
      if (this.closed || (!this.q.length && !this.st.length)) return;
      const sts = this.st, q = this.q; this.st = []; this.q = [];
      let m;
      if (sts.length === 1) m = q.length ? Object.assign({}, sts[0]) : sts[0];
      else if (sts.length > 1) m = { k: 'b', s: sts };
      else m = { k: 'q' };
      if (q.length) m.rq = q;
      this._out(m);
    }
    _arm() { if (!this.timer && !this.closed) this.timer = setTimeout(() => this._flush(), 1000 / this.hz()); }
    send(msg, reliable) {
      if (this.closed || !this.open) return false;
      if (this._mode() !== 'race') return this._out(msg);
      if (reliable !== false) {
        if (this.q.length < 120) this.q.push(msg);
        if (msg && IMMEDIATE.has(msg.k)) this._flush(); else this._arm();
        return true;
      }
      const hz = this.hz(), batch = Math.max(1, Math.round(N.RELAY_BATCH * N.RELAY_HZ / hz)), now = performance.now();
      if (now - this.lastAccept < 1000 / (hz * batch) - 4) { NetStats.relayDropped++; return false; }     // states are replaceable: drop, never queue
      this.lastAccept = now; this.st.push(msg);
      if (this.st.length >= batch) this._flush(); else this._arm();
      return true;
    }
    receive(msg) {
      if (this.closed || !msg || typeof msg !== 'object') return;
      this.lastRecv = performance.now(); this.recv++; NetStats.relayIn++;
      if (!this.open) { this.open = true; if (this.onopen) this.onopen(); }
      if (msg.k === 'bye') { this.close('peer-' + String(msg.why || 'bye').slice(0, 16)); return; }
      const deliver = (m, r) => { if (m && typeof m === 'object' && this.onmessage) this.onmessage(m, r); };
      if (Array.isArray(msg.rq)) for (const x of msg.rq.slice(0, 130)) deliver(x, true);
      if (msg.k === 'q') return;
      if (msg.k === 'b' && Array.isArray(msg.s)) { for (const x of msg.s.slice(0, 8)) deliver(x, false); return; }
      if (msg.rq) { const m = Object.assign({}, msg); delete m.rq; deliver(m, false); return; }
      deliver(msg, false);
    }
    close(reason) {
      if (this.closed) return;
      this.closed = true; this.open = false; clearTimeout(this.timer);
      try { if (this.dispose) this.dispose(); } catch (e) { /* closing */ }
      if (this.onclose) this.onclose(reason || 'closed', true);
    }
  }

  KL.Link = Link; KL.RelayLink = RelayLink;
})();
