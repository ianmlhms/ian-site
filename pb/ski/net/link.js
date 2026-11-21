/* The two kinds of link between two players (no game logic here), ported from Kart Lëtzebuerg (pb/kart-letzebuerg/net.js):
 *   RtcLink    a WebRTC peer connection with two data channels: "ev" (reliable, ordered: control, finishes, pings) and "st"
 *              (unordered, no retransmits: skier states, a lost one is simply replaced by the next). Non-trickle hand-shake: one offer
 *              and one answer per pair, the ICE candidates inside the SDP, so the Realtime channel carries two messages per pair.
 *   RelayLink  the fallback when two players cannot reach each other (school Wi-Fi with client isolation and no TURN): a Realtime
 *              channel with exactly these two players. While racing, states are thinned to RELAY_HZ * RELAY_BATCH a second and sent
 *              RELAY_BATCH at a time; reliable messages ride along with the next batch. A budget per match lowers the rate step by step
 *              and, only when it is used up, ends the relay with an explicit 'bye' (never silently).
 * Both: send(msg, reliable) -> boolean, close(reason); callbacks onmessage(msg, reliable), onopen(), onclose(reason, wasOpen). */
import { NET } from './config.js';

export const netStats = { rtcSent: 0, rtcRecv: 0, rtcBytesSent: 0, rtcBytesRecv: 0, relaySent: 0, relayRecv: 0, relayDropped: 0, links: 0 };
const parse = (data) => { try { const m = JSON.parse(data); return m && typeof m === 'object' ? m : null; } catch (error) { return null; } };

export class RtcLink {
  /* o: { peerId, initiator, iceServers, signal(type, sdp), onmessage, onopen, onclose } */
  constructor(o) {
    Object.assign(this, { id: o.peerId, kind: 'rtc', open: false, closed: false, initiator: !!o.initiator, signal: o.signal, onmessage: o.onmessage, onopen: o.onopen, onclose: o.onclose });
    this.ev = null; this.st = null; this.lastRecv = performance.now(); this.born = performance.now();
    netStats.links++;
    const pc = (this.pc = new RTCPeerConnection({ iceServers: o.iceServers || NET.ICE_SERVERS }));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.close('failed');
      else if (pc.connectionState === 'disconnected') {
        clearTimeout(this.dcTimer);
        this.dcTimer = setTimeout(() => { if (pc.connectionState !== 'connected') this.close('disconnected'); }, NET.LINK_GRACE);
      }
    };
    if (this.initiator) {
      this.wire(pc.createDataChannel('ev', { ordered: true }), true);
      this.wire(pc.createDataChannel('st', { ordered: false, maxRetransmits: 0 }), false);
    } else pc.ondatachannel = (e) => this.wire(e.channel, e.channel.label === 'ev');
    this.timeout = setTimeout(() => { if (!this.open) this.close('timeout'); }, NET.CONNECT_TIMEOUT);
  }
  wire(ch, reliable) {
    if (reliable) this.ev = ch; else this.st = ch;
    ch.onopen = () => this.check();
    ch.onclose = () => { if (this.open) this.close('channel'); };
    ch.onerror = () => {};
    ch.onmessage = (e) => {
      this.lastRecv = performance.now();
      netStats.rtcRecv++; netStats.rtcBytesRecv += e.data.length || 0;
      const m = parse(e.data);
      if (m && this.onmessage) this.onmessage(m, reliable);
    };
  }
  check() {
    if (this.open || this.closed) return;
    if (this.ev && this.ev.readyState === 'open' && this.st && this.st.readyState === 'open') {
      this.open = true; clearTimeout(this.timeout);
      if (this.onopen) this.onopen();
    }
  }
  gathered() {
    const pc = this.pc;
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', chk); resolve(); };
      const chk = () => { if (pc.iceGatheringState === 'complete') done(); };
      const t = setTimeout(done, NET.ICE_GATHER_MS);
      pc.addEventListener('icegatheringstatechange', chk);
    });
  }
  async makeOffer() {
    try {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await this.gathered();
      if (!this.closed) this.signal('offer', this.pc.localDescription.sdp);
    } catch (error) { console.warn('[ski-net] offer failed', error); this.close('offer'); }
  }
  async acceptOffer(sdp) {
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp });
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      await this.gathered();
      if (!this.closed) this.signal('answer', this.pc.localDescription.sdp);
    } catch (error) { console.warn('[ski-net] answer failed', error); this.close('answer'); }
  }
  async acceptAnswer(sdp) {
    try { await this.pc.setRemoteDescription({ type: 'answer', sdp }); } catch (error) { console.warn('[ski-net] bad answer', error); this.close('answer'); }
  }
  /** is the transport itself still up? (a stalled peer keeps it, a vanished one loses it) */
  alive() { return this.open && !this.closed && this.pc.connectionState === 'connected'; }
  send(msg, reliable) {
    const ch = reliable === false ? this.st : this.ev;
    if (this.closed || !ch || ch.readyState !== 'open') return false;
    if (reliable === false && ch.bufferedAmount > 65536) return false;        // congested: drop the replaceable state
    const s = JSON.stringify(msg);
    try { ch.send(s); } catch (error) { return false; }
    netStats.rtcSent++; netStats.rtcBytesSent += s.length;
    return true;
  }
  close(reason) {
    if (this.closed) return;
    this.closed = true; const was = this.open; this.open = false;
    clearTimeout(this.timeout); clearTimeout(this.dcTimer);
    try { if (this.ev) this.ev.close(); if (this.st) this.st.close(); this.pc.close(); } catch (error) { /* already closed */ }
    if (this.onclose) this.onclose(reason || 'closed', was);
  }
}

export class RelayLink {
  /* o: { peerId, tx(payload), dispose(), racing() -> bool, onmessage, onopen, onclose } */
  constructor(o) {
    Object.assign(this, { id: o.peerId, kind: 'relay', open: false, closed: false, tx: o.tx, dispose: o.dispose, racing: o.racing || (() => false), onmessage: o.onmessage, onopen: o.onopen, onclose: o.onclose });
    this.count = 0; this.q = []; this.st = []; this.lastAccept = 0; this.timer = 0; this.lastRecv = performance.now(); this.born = performance.now();
    this.budget = o.budget || NET.RELAY_MATCH_MSGS; this.hzMax = o.hzMax || NET.RELAY_HZ;          // R7-D: the free ride's own budget
    this.hello = setInterval(() => { if (!this.open && !this.closed) this.out({ k: 'hello' }); else clearInterval(this.hello); }, NET.RELAY_HELLO_MS);
    this.out({ k: 'hello' });
  }
  hz() {
    const frac = this.count / this.budget;
    let hz = this.hzMax;
    for (const [f, h] of NET.RELAY_SLOW) if (frac >= f) hz = Math.min(hz, h);
    return hz;
  }
  out(msg) {
    if (this.closed) return false;
    if (this.count >= this.budget) { this.bye('budget'); return false; }
    this.count++; netStats.relaySent++;
    if (this.count === Math.floor(this.budget * 0.6) || this.count === Math.floor(this.budget * 0.85)) console.warn(`[ski-net] relay to ${this.id}: ${this.count}/${this.budget} messages, rate lowered`);
    try { this.tx(msg); } catch (error) { return false; }
    return true;
  }
  bye(why) {
    if (this.closed) return;
    console.warn(`[ski-net] relay to ${this.id} ends (${why})`);
    try { this.tx({ k: 'bye', why }); } catch (error) { /* closing */ }
    this.close(why);
  }
  flush() {
    clearTimeout(this.timer); this.timer = 0;
    if (this.closed || (!this.q.length && !this.st.length)) return;
    const m = { k: 'b', s: this.st, rq: this.q };
    this.st = []; this.q = [];
    this.out(m);
  }
  arm() { if (!this.timer && !this.closed) this.timer = setTimeout(() => this.flush(), 1000 / this.hz()); }
  alive() { return this.open && !this.closed; }
  send(msg, reliable) {
    if (this.closed || !this.open) return false;
    if (reliable !== false) {
      if (this.q.length < 120) this.q.push(msg);
      if (this.racing()) this.arm(); else this.flush();
      return true;
    }
    const hz = this.hz(), now = performance.now();
    const every = 1000 / (hz * NET.RELAY_BATCH) - 4;
    if (now - this.lastAccept < every) { netStats.relayDropped++; return false; }     // states are replaceable: drop, never queue
    this.lastAccept = now; this.st.push(msg);
    if (this.st.length >= NET.RELAY_BATCH || !this.racing()) this.flush(); else this.arm();
    return true;
  }
  receive(msg) {
    if (this.closed || !msg || typeof msg !== 'object') return;
    this.lastRecv = performance.now(); netStats.relayRecv++;
    if (!this.open) { this.open = true; clearInterval(this.hello); this.out({ k: 'hello' }); if (this.onopen) this.onopen(); }
    if (msg.k === 'bye') { this.close(`peer-${String(msg.why || 'bye').slice(0, 16)}`); return; }
    if (msg.k !== 'b') return;
    const deliver = (m, r) => { if (m && typeof m === 'object' && this.onmessage) this.onmessage(m, r); };
    if (Array.isArray(msg.rq)) for (const x of msg.rq.slice(0, 130)) deliver(x, true);
    if (Array.isArray(msg.s)) for (const x of msg.s.slice(0, 8)) deliver(x, false);
  }
  close(reason) {
    if (this.closed) return;
    this.closed = true; const was = this.open; this.open = false;
    clearTimeout(this.timer); clearInterval(this.hello);
    try { if (this.dispose) this.dispose(); } catch (error) { /* closing */ }
    if (this.onclose) this.onclose(reason || 'closed', was);
  }
}
