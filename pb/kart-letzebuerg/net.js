/* Kart Lëtzebuerg — transport for online play: WebRTC data-channel links (one reliable "ev", one unreliable "st" channel)
 * and the capped Supabase-Realtime relay used only when WebRTC cannot connect. No game logic in here.
 * Hand-shake is NON-trickle: one offer and one answer per pair (ICE candidates are inside the SDP), to keep Realtime traffic tiny. */
(function () {
  'use strict';
  const KL = window.KL, N = KL.NET;
  const NetStats = (KL.netStats = { relayMsgs: 0, relayDropped: 0, rtcSent: 0, rtcRecv: 0, rtcBytesSent: 0, rtcBytesRecv: 0, links: 0 });
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
        else if (pc.connectionState === 'disconnected') { clearTimeout(this._dc); this._dc = setTimeout(() => { if (pc.connectionState !== 'connected') this.close('disconnected'); }, 4000); }
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

  /* Relay over the Realtime channel for one peer that has no WebRTC path. State packets are throttled to RELAY_HZ,
   * every message counts against the hard cap, and the relayed volume is logged. */
  class RelayLink {
    /* o: { peerId, myId, broadcast(payload), onmessage, onclose } */
    constructor(o) {
      Object.assign(this, { id: o.peerId, kind: 'relay', open: true, closed: false, myId: o.myId, bcast: o.broadcast, onmessage: o.onmessage, onclose: o.onclose, rtt: null, lastRecv: performance.now(), count: 0 });
      this.pending = null; this.lastState = 0;
    }
    _out(msg) {
      if (this.closed) return false;
      if (this.count >= N.RELAY_MAX_MSGS) { console.warn('[kart-net] relay cap reached for', this.id); this.close('cap'); return false; }
      this.count++; NetStats.relayMsgs++;
      if (this.count % 100 === 0) console.info('[kart-net] relay to/from ' + this.id + ': ' + this.count + '/' + N.RELAY_MAX_MSGS + ' messages');
      this.bcast({ to: this.id, from: this.myId, m: msg });
      return true;
    }
    send(msg, reliable) {
      if (reliable !== false) return this._out(msg);
      const now = performance.now();
      if (now - this.lastState < 1000 / N.RELAY_HZ) { NetStats.relayDropped++; return false; }   // state packets are replaceable: drop, never queue
      this.lastState = now;
      return this._out(msg);
    }
    receive(msg) { this.lastRecv = performance.now(); if (this.onmessage) this.onmessage(msg, true); }
    close(reason) {
      if (this.closed) return;
      this.closed = true; this.open = false;
      if (this.onclose) this.onclose(reason || 'closed', true);
    }
  }

  KL.Link = Link; KL.RelayLink = RelayLink;
})();
