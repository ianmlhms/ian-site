/* Paket Express: metres / seconds, no external art. All progress merges are monotonic. */
(function () {
  'use strict';
  const DAILY_SAVE=PX.career.normalize(),DAILY_SPEC={...PX.career.spec(DAILY_SAVE),stops:PX.config.dailySlots};
  const SHIFT_SECONDS = PX.config.shiftSeconds, WORLD_EDGE = PX.edge, STOP_RADIUS = PX.config.stopRadius;
  const CRASH_COOLDOWN = PX.config.crashCooldown, FREE_RATE = PX.config.freeRate, SAVE_KEY = 'pb_save_paket-express';
  // srcdoc's location has an opaque URL; its base URI inherits the arcade's real origin.
  const HOST_ORIGIN = new URL(document.baseURI).origin;
  const LIMIT = Number.MAX_SAFE_INTEGER, ROADS = Object.freeze(PX.roads);
  const VEHICLES = PX.config.vehicles;
  const PLACES = PX.places;
  const TEXT = {
    lb: {
      eyebrow: 'LËTZEBUERG · ZËNTER 08:00', title: 'Eng Stad.\nDeng Tour.', intro: "Kleng Stroossen, grouss Missioun. Huel d'Päck op a bréng se pünktlech un d'Dier.",
      shift: 'Schicht · 5 min', shiftDesc: "Géint d'Auer. Fir de Rekord.", free: 'Fräi fueren', freeDesc: 'Ouni Drock · hallef Punkten', garage: 'Deng Garage', lifetime: 'Liewenszäit-Punkten',
      startHint: "Stop kuerz am giele Krees fir ofzehuelen oder ze liwweren. D'Garage wiessels du tëscht den Touren.", loading: "D'Stad gëtt opgebaut…", edge: "Dir verloosst d'Stad · Dréi w.e.g. ëm", ready: '36 Adressen. Eng nei Tour bei all Start.',
      points: 'Punkten', deliveries: 'Liwwerungen', best: 'Rekord', pause: 'Ⅱ Paus', paused: 'Kuerz Paus.', pausedDesc: 'Deng Tour waart op dech.', resume: 'Weiderfueren',
      camera: 'Kamera', reset: '↻ Strooss', horn: 'Hup', mute: 'Toun', finish: 'Tour ophalen', drift: 'Drift', brake: 'Brems', gas: 'Gas', again: 'Nach eng Kéier', ended: 'Schicht fäerdeg!', freeEnded: 'Flott Tour!',
      controls: 'WASD / ↑↓←→ fueren · Space Drift · H Hup · C Kamera · R Strooss · P Paus · N Kaart · M Toun',
      pickup: 'Ofhuelen bei:', dropoff: 'Liwweren un:', boarding: 'Passagéier bei:', busStop: 'Nächsten Arrêt:', stop: 'Stop am giele Krees', loadingParcel: 'Gëtt agelueden…', unloading: 'Gëtt ofginn…',
      picked: 'U Bord! Op bei déi nächst Adress.', delivered: 'Tour fäerdeg', failed: "Zäit eriwwer. Eng nei Tour waart!", crash: 'Bump! −12 Punkten op dëser Tour', resetDone: 'Zréck op der Strooss', unlocked: 'Fräigeschalt', selected: 'Ausgewielt', needed: 'nach',
      autoDesc: 'Séier · 1 Pak', vanDesc: '2 Päck pro Tour', busDesc: '3 Passagéier-Arrêten', earn: 'Punkten', soundOn: 'Toun un', soundOff: 'Toun aus', left: 'Lénks steieren', right: 'Riets steieren',
      engineError: "Den 3D-Motor konnt net starten. Kontrolléier deng Verbindung an lued d'Säit nei.", saveError: 'Späicheren net méiglech. Halt dës Säit op fir däi Fortschrëtt.', audioError: 'Den Toun ass net disponibel. Du kanns weiderspillen.',
    },
    de: {
      eyebrow: 'LUXEMBURG · SEIT 08:00', title: 'Deine Stadt.\nDeine Tour.', intro: 'Kleine Straßen, große Mission. Hole Pakete ab und bring sie pünktlich an die Tür.',
      shift: 'Schicht · 5 Min.', shiftDesc: 'Gegen die Uhr. Für den Rekord.', free: 'Freie Fahrt', freeDesc: 'Ohne Zeitdruck · halbe Punkte', garage: 'Deine Garage', lifetime: 'Gesamtpunkte', startHint: 'Halte kurz im gelben Kreis zum Abholen oder Ausliefern. Fahrzeuge wechselst du zwischen Touren.', loading: 'Die Stadt entsteht…', edge: 'Du verlässt die Stadt · Bitte umdrehen', ready: '36 Adressen. Bei jedem Start eine neue Tour.',
      points: 'Punkte', deliveries: 'Lieferungen', best: 'Rekord', pause: 'Ⅱ Pause', paused: 'Kurze Pause.', pausedDesc: 'Deine Tour wartet auf dich.', resume: 'Weiterfahren', camera: 'Kamera', reset: '↻ Straße', horn: 'Hupe', mute: 'Ton', finish: 'Tour beenden', drift: 'Drift', brake: 'Bremse', gas: 'Gas', again: 'Noch einmal', ended: 'Schicht geschafft!', freeEnded: 'Gute Fahrt!',
      controls: 'WASD / ↑↓←→ fahren · Leertaste Drift · H Hupe · C Kamera · R Straße · P Pause · N Karte · M Ton', pickup: 'Abholen bei:', dropoff: 'Liefern an:', boarding: 'Fahrgäste bei:', busStop: 'Nächster Halt:', stop: 'Im gelben Kreis anhalten', loadingParcel: 'Wird eingeladen…', unloading: 'Wird abgegeben…', picked: 'An Bord! Auf zur nächsten Adresse.', delivered: 'Tour geschafft', failed: 'Zeit abgelaufen. Eine neue Tour wartet!', crash: 'Rempler! −12 Punkte auf dieser Tour', resetDone: 'Zurück auf der Straße', unlocked: 'Freigeschaltet', selected: 'Ausgewählt', needed: 'noch', autoDesc: 'Schnell · 1 Paket', vanDesc: '2 Pakete pro Tour', busDesc: '3 Fahrgasthalte', earn: 'Punkte', soundOn: 'Ton an', soundOff: 'Ton aus', left: 'Links lenken', right: 'Rechts lenken',
      engineError: 'Die 3D-Engine konnte nicht starten. Prüfe deine Verbindung und lade die Seite neu.', saveError: 'Speichern nicht möglich. Lass diese Seite für deinen Fortschritt offen.', audioError: 'Ton nicht verfügbar. Du kannst weiterspielen.',
    },
    en: {
      eyebrow: 'LUXEMBOURG · SINCE 08:00', title: 'Your town.\nYour route.', intro: 'Little streets, big mission. Pick up parcels and bring them to the door on time.', shift: 'Shift · 5 min', shiftDesc: 'Beat the clock. Set a record.', free: 'Free drive', freeDesc: 'No pressure · half the points', garage: 'Your garage', lifetime: 'Lifetime points', startHint: 'Stop briefly in the yellow circle to pick up or deliver. Change vehicles between runs.', loading: 'Building the town…', edge: 'Leaving town · Please turn around', ready: '36 addresses. A new route with every start.',
      points: 'Points', deliveries: 'Deliveries', best: 'Best', pause: 'Ⅱ Pause', paused: 'Taking a break.', pausedDesc: 'Your route is waiting for you.', resume: 'Keep driving', camera: 'Camera', reset: '↻ Road', horn: 'Horn', mute: 'Sound', finish: 'End drive', drift: 'Drift', brake: 'Brake', gas: 'Gas', again: 'Drive again', ended: 'Shift complete!', freeEnded: 'Nice drive!',
      controls: 'WASD / ↑↓←→ drive · Space drift · H horn · C camera · R reset · P pause · N map · M sound', pickup: 'Pick up at:', dropoff: 'Deliver to:', boarding: 'Passengers at:', busStop: 'Next stop:', stop: 'Stop in the yellow circle', loadingParcel: 'Loading…', unloading: 'Dropping off…', picked: 'On board! Head to the next address.', delivered: 'Route complete', failed: 'Time up. A new route is waiting!', crash: 'Bump! −12 points on this route', resetDone: 'Back on the road', unlocked: 'Unlocked', selected: 'Selected', needed: 'more', autoDesc: 'Nimble · 1 parcel', vanDesc: '2 parcels per route', busDesc: '3 passenger stops', earn: 'points', soundOn: 'Sound on', soundOff: 'Sound off', left: 'Steer left', right: 'Steer right',
      engineError: 'The 3D engine could not start. Check your connection and reload the page.', saveError: 'Could not save. Keep this page open to retain your progress.', audioError: 'Sound is unavailable. You can keep playing.',
    },
  };
  const $ = id => document.getElementById(id);
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const validNumber = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(Math.min(n, LIMIT)) : 0;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const vehicle = () => ({...PX.career.spec(progress),name:text(PX.career.spec(progress).name)});
  const formatTime = seconds => { const rounded = Math.ceil(Math.max(0, seconds)); return Math.floor(rounded / 60) + ':' + String(rounded % 60).padStart(2, '0'); };
  let lang = 'lb', progress = PX.career.normalize();
  let trafficSetting=readStore('px_traffic')||'normal';
  if(!PX.config.traffic[trafficSetting])trafficSetting='normal';
  let runSpec=null,runTraffic=trafficSetting,weather=forecast(),runDay=PX.missions.day(),dailyRoute=[],dailyIndex=0,combo=PX.jobs.emptyCombo(),shiftCash=0,crashes=0,luxWorld,boardRows=[],boardError='',pendingDaily=null;
  function forecast(){return ['sunny','rain','night'][PX.missions.seed(PX.missions.day()+':'+progress.savedAt)%3];}
  const runMultiplier=()=>PX.config.traffic[runTraffic].multiplier;
  function activeSave(){return mode==='daily'&&phase==='running'?DAILY_SAVE:progress;}
  function activeVehicle(){return mode==='daily'&&phase==='running'?{...DAILY_SPEC,name:text('autoName')}:phase==='running'&&runSpec?{...runSpec,name:text(runSpec.name)}:vehicle();}
  let mode = 'shift', phase = 'menu', paused = false, highCamera = false, score = 0, deliveries = 0, elapsed = 0;
  let saveWait=0;
  let job = null, dwell = 0, collisionWait = 0, noticeUntil = 0, audio = null, muted = false, audioFailed = false, engineFailed = false;
  let renderer, scene, camera, sun, ambient, playerMesh, beacon, beaconRing, animation = 0, lastFrame = 0, hudWait = 0, demoTime = 0;
  const input = new Set(), heldPointers = new Map(), obstacles = [], traffic = [];
  const player = { x: -25, z: 3, yaw: Math.PI / 2, vx: 0, vz: 0, speed: 0 };
  let city, navigation, sky, skyColors, trafficSystem, nightAmount = 0, bigMap = false, edgeNotice = 0;
  let quality = readStore('px_quality') || ((navigator.maxTouchPoints > 0 || /iPad|iPhone/.test(navigator.userAgent)) ? 'medium' : 'high');
  if (!['high', 'medium', 'low'].includes(quality)) quality = 'medium';
  const QUALITY = { lb: ['Qualitéit', 'Héich', 'Mëttel', 'Niddreg'], de: ['Qualität', 'Hoch', 'Mittel', 'Niedrig'], en: ['Quality', 'High', 'Medium', 'Low'] };
  const MAP_TEXT = { lb: ['Kaart', 'Zoumaachen'], de: ['Karte', 'Schließen'], en: ['Map', 'Close'] };
  function warn(context, error) { console.warn('[Paket Express] ' + context, error); }
  function text(key) { return PX.copy[lang][key] || TEXT[lang][key] || key; }
  function readStore(key) {
    try { return localStorage.getItem(key); }
    catch (error) { warn('Storage read failed', error); return null; }
  }
  function post(message) {
    if (parent === window) return;
    try { parent.postMessage(message, HOST_ORIGIN); }
    catch (error) { warn('Arcade message failed', error); notify(text('saveError')); }
  }
  function notify(message) { $('notice').textContent = message; noticeUntil = performance.now() + 2600; }
  function save() {
    progress = { ...progress, tb: progress.lifetime, savedAt: Date.now() };
    if (parent === window) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(progress)); }
      catch (error) { warn('Progress save failed', error); notify(text('saveError')); }
    } else post({ __pbSave: 1, data: { ...progress } });
  }
  function mergeSave(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    progress=PX.career.merge(progress,data);if(phase==='menu')weather=forecast();refreshGarage();updateHUD();
  }
  function purchase(kind,id){
    if(phase==='running')return;
    const next=kind==='select'&&progress.owned.includes(id)?{...progress,vehicle:id}:PX.career.buy(progress,kind,id);
    if(!next){notify(text('needCash'));return;}
    progress=next;save();refreshGarage();if(scene)replacePlayer();notify(text(kind==='select'?'selected':'bought'));
  }
  function refreshGarage() {
    $('lifetime').textContent=progress.lifetime.toLocaleString(lang);
    PX.shop.render(progress,text,purchase);
    $('trafficSetting').value=trafficSetting;
    for(const option of $('trafficSetting').options){const setting=PX.config.traffic[option.value];option.textContent=setting.icon+' '+text(option.value)+' · ×'+setting.multiplier;}
    $('weatherPreview').textContent=text(weather);
    $('dailyDate').textContent=PX.missions.day()+' · '+text('ends');$('dailyWeather').textContent=text(['sunny','rain','night'][PX.missions.seed(PX.missions.day())%3])+' · 🚗 '+text('normal');
    $('intro').textContent=text('menuPurpose');
    if(luxWorld)luxWorld.refresh(activeSave(),text);
    renderBoard();
  }
  function mission(event,value=1,district=null){
    const oldRank=PX.career.rank(progress),result=PX.missions.update(progress,event,value,district);progress=result.save;
    if(result.completed.length){notify('✓ '+text('missionDone')+' · +'+result.completed.length*PX.config.dailyReward+' €');save();celebrateRank(oldRank);}
  }
  function award(amount){
    const oldRank=PX.career.rank(progress);progress=PX.career.earn(progress,amount);shiftCash+=amount;
    celebrateRank(oldRank);
    save();
  }
  function celebrateRank(oldRank){
    if(PX.career.rank(progress)>oldRank){notify('🎉 '+text('rankUp')+' · '+text('rank'+PX.career.rank(progress)));$('rank').classList.add('celebrate');setTimeout(()=>$('rank').classList.remove('celebrate'),2400);}
  }
  function renderBoard(){
    const rows=boardRows.filter(r=>r.user_id&&(r.rank<=5||r.is_self));
    $('dailyBoard').replaceChildren(...rows.map(r=>{const li=document.createElement('li');li.textContent='#'+r.rank+' '+(r.is_self?text('you'):r.username||'—')+' · '+r.score;return li;}));
    $('dailyStatus').textContent=boardError?text(boardError):(!rows.length?text('boardEmpty'):'');
  }
  async function loadBoard(){
    try{const rows=await PX.daily.board();if(!Array.isArray(rows))throw new Error('Invalid daily board');boardRows=rows;boardError='';}
    catch(error){boardRows=[];boardError=/signed|jwt|offline|auth/i.test(error.message)?'signIn':'boardError';warn('Daily board',error.message);}
    renderBoard();
  }
  async function submitDaily(){
    if(!pendingDaily)return;
    if(pendingDaily.day!==PX.missions.day()){pendingDaily=null;notify(text('dailySaveError'));return;}
    $('retryDaily').hidden=true;
    try{await PX.daily.submit(pendingDaily.score);pendingDaily=null;notify(text('dailySaved'));await loadBoard();}
    catch(error){warn('Daily submission',error.message);notify(text(/signed|jwt|auth|offline/i.test(error.message)?'signIn':'dailySaveError'));$('retryDaily').hidden=false;}
  }
  function translate() {
    document.documentElement.lang = lang;document.querySelector('.languages').setAttribute('aria-label',text('languages'));
    document.querySelectorAll('[data-t]').forEach(node => { node.textContent = text(node.dataset.t); });
    $('title').style.whiteSpace = 'pre-line';
    document.querySelectorAll('[data-lang]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lang === lang)));
    document.querySelector('[data-input="left"]').setAttribute('aria-label', text('left'));
    document.querySelector('[data-input="right"]').setAttribute('aria-label', text('right'));
    $('world').setAttribute('aria-label', 'Paket Express · ' + text('free'));
    $('minimap').setAttribute('aria-label', text('pickup') + ' ' + (job ? target().name : 'Post, Groussgaass'));
    refreshGarage(); updateQuality(); updateMapText(); updateHUD(); updateEnd(); $('bootStatus').textContent = text(engineFailed ? 'engineError' : renderer ? 'ready' : 'loading'); updateMute();
  }
  function theme() {
    try { document.body.classList.toggle('dark', JSON.parse(readStore('site_theme') || '{}').mode === 'dark'); }
    catch (error) { warn('Theme read failed', error); }
  }

  function replacePlayer() {
    if (playerMesh) {
      scene.remove(playerMesh);
      // Shared cached body geometry stays alive; only private wheel buffers are released.
      playerMesh.children.filter(m => m.isInstancedMesh).forEach(m => { m.geometry.dispose(); m.dispose(); });
    }
    playerMesh = PX.makeVehicle(activeVehicle(), activeVehicle().color, true); scene.add(playerMesh); syncPlayer();
  }
  function syncPlayer(dt = 0) {
    playerMesh.position.set(player.x, .05+PX.lux.height(player), player.z); playerMesh.rotation.y = player.yaw;
    playerMesh.userData.update(player.longitudinal || 0, player.steering || 0, dt, player.roll || 0, player.pitch || 0, nightAmount);
  }
  function wheelAngle(index) {
    const wheels = playerMesh?.children.find(mesh => mesh.isInstancedMesh); if (!wheels) return 0;
    const matrix = new THREE.Matrix4(); wheels.getMatrixAt(index, matrix); return Math.atan2(-matrix.elements[2], matrix.elements[0]);
  }
  function buildTraffic() {
    trafficSystem = PX.createTraffic(scene); traffic.push(...trafficSystem.cars);
  }

  function updateQuality() {
    const labels = QUALITY[lang], i = ['high', 'medium', 'low'].indexOf(quality);
    $('quality').textContent = labels[0] + ': ' + labels[i + 1]; $('quality').dataset.quality = quality;
    if (!renderer) return;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality === 'high' ? 1.5 : quality === 'medium' ? 1.25 : 1));
    sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.enabled = quality !== 'low'; scene.fog.near = quality === 'high' ? 130 : quality === 'medium' ? 110 : 75; scene.fog.far = quality === 'high' ? 330 : quality === 'medium' ? 270 : 210; resize();
  }
  function updateMapText() {
    $('mapTitle').textContent = 'Luxembourg · ' + MAP_TEXT[lang][0]; $('closeMap').textContent = MAP_TEXT[lang][1];
    $('minimap').setAttribute('title', MAP_TEXT[lang][0] + ' · N');
  }
  function mapToggle() {
    if (phase !== 'running') return;
    bigMap = !bigMap; clearInput(); $('mapScreen').hidden = !bigMap;
    $('minimap').setAttribute('aria-expanded', String(bigMap));
    if (bigMap) { drawMap(); $('closeMap').focus(); } else $('minimap').focus();
  }
  function init3D() {
    if (!window.THREE) { bootError(new Error('three.js r160 unavailable')); return; }
    try {
      renderer = new THREE.WebGLRenderer({ canvas: $('world'), antialias: true, powerPreference: 'low-power' });
      $('world').addEventListener('webglcontextlost', event => {
        event.preventDefault(); if (phase === 'running' && !paused) pauseToggle();
        warn('WebGL context lost', event.statusMessage); notify(text('engineError'));
      });
      $('world').addEventListener('webglcontextrestored', () => { resize(); requestRender(); });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      scene = new THREE.Scene(); scene.background = new THREE.Color('#b7cbd1'); scene.fog = new THREE.Fog('#b7cbd1', 110, 310);
      camera = new THREE.PerspectiveCamera(59, 1, .15, 1100);
      ambient = new THREE.HemisphereLight('#dfeaf1', '#8b8065', 1.55); scene.add(ambient);
      sun = new THREE.DirectionalLight('#fff0d6', 3.1); sun.position.set(-35, 65, -25); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -38; sun.shadow.camera.right = sun.shadow.camera.top = 38;
      sun.shadow.camera.near = 1; sun.shadow.camera.far = 130; sun.shadow.normalBias = .045; sun.shadow.bias = -.00015; sun.shadow.radius = 3;
      scene.add(sun, sun.target);
      skyColors = { top: new THREE.Color('#77aac2'), horizon: new THREE.Color('#b9d2d8') };
      const skyMaterial = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', side: THREE.BackSide, fog: false, depthWrite: false });
      skyMaterial.onBeforeCompile = shader => {
        shader.uniforms.skyTop = { value: skyColors.top }; shader.uniforms.skyHorizon = { value: skyColors.horizon };
        shader.vertexShader = 'varying float skyY;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n skyY = position.y / 700.0;');
        shader.fragmentShader = 'uniform vec3 skyTop; uniform vec3 skyHorizon; varying float skyY;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = mix(skyHorizon, skyTop, smoothstep(-.08, .8, skyY));');
      };
      sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 20), skyMaterial); sky.frustumCulled = false; scene.add(sky);
      city = PX.buildCity(scene, obstacles); luxWorld=PX.lux.build(scene); PX.allowedPoint=point=>PX.career.allowed(point,activeSave()); PX.mapTargets=()=>job&&job.step>=0?job.route.filter((_,i)=>!job.completed.includes(i)).map((p,i)=>({...p,order:i+1})):[]; navigation = PX.navigation(scene); replacePlayer(); buildTraffic(); updateQuality();
      beacon = new THREE.Group();
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.8, 3.4, 4), new THREE.MeshStandardMaterial({ color: '#ffbd39', emissive: '#ffbd39', emissiveIntensity: .5, depthTest: false }));
      arrow.rotation.z = Math.PI; arrow.position.y = 10; arrow.renderOrder = 5; beacon.add(arrow);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffe397', emissive: '#ffe397', emissiveIntensity: .7, transparent: true, opacity: .6 })); beam.position.y = 4; beacon.add(beam); scene.add(beacon);
      beaconRing = new THREE.Mesh(new THREE.RingGeometry(4.8, 5.4, 40), new THREE.MeshStandardMaterial({ color: '#ffcc4d', emissive: '#ffcc4d', emissiveIntensity: .7, transparent: true, opacity: .85, side: THREE.DoubleSide }));
      beaconRing.rotation.x = -Math.PI / 2; beaconRing.position.y = .3; scene.add(beaconRing); beacon.visible = false; beaconRing.visible = false;
      camera.position.set(-65, 70, 115); camera.lookAt(0, 0, 0); resize(); translate(); requestRender();
    } catch (error) { bootError(error); }
  }
  function bootError(error) {
    engineFailed = true; warn('3D startup failed', error); $('bootStatus').textContent = text('engineError'); $('startShift').disabled = true; $('startFree').disabled = true; $('startDaily').disabled=true;
  }
  function resize() {
    if (!renderer) return;
    const width = $('game').clientWidth, height = $('game').clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }

  function soundStart() {
    if (audioFailed) return;
    try {
      if (!audio) audio = PX.createAudio();
      if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(error => warn('Audio resume failed', error));
    } catch (error) { audioFailed = true; warn('Audio startup failed', error); notify(text('audioError')); }
  }
  function tone(frequency, duration, type = 'sine') { if (audio) audio.chime(frequency, duration, type); }
  function horn(held) { soundStart(); audio?.horn(held, activeVehicle()); }
  function updateMute() { if (audio) audio.master.gain.setTargetAtTime(muted || phase !== 'running' || paused ? 0 : .5, audio.ctx.currentTime, .02); $('mute').textContent = text(muted ? 'soundOff' : 'soundOn'); $('mute').setAttribute('aria-pressed', String(muted)); }
  function muteToggle() {
    muted = !muted;
    try { localStorage.setItem('pb_muted', muted ? '1' : '0'); }
    catch (error) { warn('Mute preference save failed', error); }
    post({ __pbSndMute: muted }); updateMute();
  }
  function clearInput() {
    input.clear(); heldPointers.clear(); if (audio) audio.horn(false, activeVehicle()); document.querySelectorAll('[data-input]').forEach(button => button.classList.remove('on'));
  }
  function start(nextMode) {
    if (!renderer) return;
    mode = nextMode;runSpec=PX.career.spec(progress); phase = 'running'; runDay=PX.missions.day();runTraffic=mode==='daily'?PX.config.dailyTraffic:trafficSetting;weather=mode==='daily'?['sunny','rain','night'][PX.missions.seed(runDay)%3]:weather;dailyIndex=0;dailyRoute=mode==='daily'?PX.daily.route(runDay):[];combo=PX.jobs.emptyCombo();shiftCash=0;crashes=0;luxWorld.reset();trafficSystem.configure(runTraffic,mode==='daily'?'traffic:'+runDay:String(Date.now()));luxWorld.refresh(activeSave(),text); paused = false; score = 0; deliveries = 0; elapsed = 0; lastFrame = 0; dwell = 0; collisionWait = 0;
    clearInput(); Object.assign(player, { x: -25, z: 3, yaw: Math.PI / 2, vx: 0, vz: 0, speed: 0, longitudinal: 0, steering: 0, slip: 0, lateral: 0, yawRate: 0, rearRelease: 0, tyreSlip: 0, roll: 0, pitch: 0, reverseDelay: 0 }); replacePlayer();
    bigMap = false; $('mapScreen').hidden = true;
    $('menu').hidden = true; $('endScreen').hidden = true; $('pauseScreen').hidden = true; $('hud').hidden = false; $('finish').hidden = mode !== 'free';
    Arcade.startRun(); soundStart(); newJob(); updateHUD();
    camera.position.set(player.x + 17, 13, player.z); camera.lookAt(player.x, 1, player.z);
  }
  function newJob(forced=null) {
    try{job=mode==='daily'?structuredClone(dailyRoute[dailyIndex++]):PX.jobs.create(player,activeVehicle(),progress,Math.random,forced);}
    catch(error){warn('Job creation failed',error);end();return;}
    if(!job){end();return;}
    dwell=0;updateTarget();updateHUD();
  }
  function target(){return job.step<0?job.pickup:job.route[job.step];}
  function chooseDrop(index){
    if(!job||job.kind!=='multi'||job.step<0||job.completed.includes(index))return;
    job={...job,step:index};dwell=0;updateTarget();
  }
  function updateTarget(){
    const place=target();navigation.update(player,place,true);beacon.position.set(place.x,0,place.z);beaconRing.position.set(place.x,.3,place.z);beacon.visible=beaconRing.visible=true;
    trafficSystem.configure(runTraffic,null,[job.pickup,...job.route]);
    $('minimap').setAttribute('aria-label',text(job.step<0?'pickup':'dropoff')+' '+place.name);
    $('dropChoices').replaceChildren(...(job.kind==='multi'&&job.step>=0?job.route.flatMap((p,i)=>{
      if(job.completed.includes(i))return [];const button=document.createElement('button');button.textContent=(i+1)+'. '+p.name;button.setAttribute('aria-pressed',String(i===job.step));button.addEventListener('click',()=>chooseDrop(i));return [button];
    }):[]));
  }
  function completeStop(){
    if(job.step<0){job={...job,step:0,pickedAt:elapsed};notify(text('picked'));tone(620,.14);}
    else{
      const place=target();combo=PX.jobs.combo(combo,elapsed);
      const raw=Math.floor(PX.jobs.pay(job,activeVehicle(),elapsed)*combo.multiplier*(weather==='sunny'?1:PX.config.weatherBonus)*(mode==='free'?FREE_RATE:1));
      score=Math.min(LIMIT,score+raw);deliveries++;
      notify(PX.jobs.icons[job.kind]+' '+text('delivered')+' · +'+raw+' € · ×'+combo.multiplier);award(raw);
      mission('delivery',1,place.district);if(job.kind==='express')mission('express');mission('combo',combo.multiplier);
      const completed=[...job.completed,job.step];job={...job,completed};
      const next=job.route.findIndex((_,i)=>!completed.includes(i));
      tone(880,.25);if(next<0){newJob();return;}job={...job,step:next};
    }
    dwell=0;updateTarget();updateHUD();
  }
  function end() {
    if (phase !== 'running') return;
    phase = 'end'; paused = false; bigMap = false; $('mapScreen').hidden = true; clearInput(); $('hud').hidden = true; $('pauseScreen').hidden = true; $('endScreen').hidden = false;
    if(mode==='shift'&&elapsed>=SHIFT_SECONDS&&crashes===0)mission('clean');
    if(mode==='daily'&&runDay===PX.missions.day()){const final=Math.floor(score*runMultiplier());progress={...progress,dailyBest:{[runDay]:Math.max(validNumber(progress.dailyBest[runDay]),final)}};pendingDaily={score:final,day:runDay};submitDaily();}
    if (mode === 'shift') { const final=Math.floor(score*runMultiplier()); progress = { ...progress, best: Math.max(progress.best, final) }; Arcade.score(final); Arcade.gameOver(final); }
    save(); updateEnd();
  }
  function updateEnd() {
    $('endTitle').textContent = text(mode === 'shift' ? 'ended' : 'freeEnded'); $('endPoints').textContent = Math.floor(score*runMultiplier()).toLocaleString(lang);
    $('endTraffic').textContent=PX.config.traffic[runTraffic].icon+' '+text(runTraffic)+' · '+score+' × '+runMultiplier();$('endCash').textContent='+'+shiftCash.toLocaleString(lang)+' € · '+text('wallet')+' '+progress.wallet.toLocaleString(lang)+' €';
    $('endStats').textContent = deliveries + ' ' + text('deliveries') + ' · ' + text('points');
    $('endBest').textContent = text(mode === 'shift' ? 'best' : 'lifetime') + ' · ' + (mode === 'shift' ? progress.best : progress.lifetime).toLocaleString(lang);
  }
  function pauseToggle() {
    if (phase !== 'running') return;
    paused = !paused; clearInput(); $('pauseScreen').hidden = !paused; $('pause').setAttribute('aria-pressed', String(paused));
  }
  function resetRoad() {
    const nearestX = ROADS.reduce((a, b) => Math.abs(player.x - a) < Math.abs(player.x - b) ? a : b);
    const nearestZ = ROADS.reduce((a, b) => Math.abs(player.z - a) < Math.abs(player.z - b) ? a : b);
    if (Math.abs(player.x - nearestX) < Math.abs(player.z - nearestZ)) { player.x = nearestX + 3; player.z = clamp(player.z, -285, 285); player.yaw = 0; }
    else { player.z = nearestZ + 3; player.x = clamp(player.x, -285, 285); player.yaw = Math.PI / 2; }
    if(!PX.career.allowed(player,activeSave())){
      const candidates=ROADS.flatMap(x=>ROADS.map(z=>({x:x+3,z:z+3}))).filter(p=>PX.career.allowed(p,activeSave()));
      const nearest=candidates.reduce((a,b)=>distance(player,a)<distance(player,b)?a:b);
      player.x=nearest.x;player.z=nearest.z;
    }
    // Roundabout islands occupy the centre; moving along the chosen lane clears them.
    if (obstacles.some(o => Math.abs(player.x - o.x) < o.hx + 2 && Math.abs(player.z - o.z) < o.hz + 2)) {
      if (player.yaw === 0) player.z += 12; else player.x += 12;
    }
    player.vx = 0; player.vz = 0; player.speed = 0; player.longitudinal = 0; player.slip = 0; player.lateral = 0; player.yawRate = 0; player.rearRelease = 0; dwell = 0; notify(text('resetDone'));
  }
  function crash() {
    if (collisionWait > 0) return;
    collisionWait = CRASH_COOLDOWN; job=PX.jobs.crash(job);combo=PX.jobs.emptyCombo();crashes++;$('jobCard').classList.remove('impact');void $('jobCard').offsetWidth;$('jobCard').classList.add('impact'); dwell = 0; notify(text('crash')); audio?.thud();
  }
  function movePlayer(dt) {
    const spec = {...activeVehicle(),grip:activeVehicle().grip*(weather==='rain'?PX.config.rainGrip:1)}, oldX = player.x, oldZ = player.z;
    PX.drive(player, spec, input, dt);
    const radius = spec.id === 'bus' ? 2.25 : 1.4;
    const extentX = Math.abs(Math.cos(player.yaw)) * 1.1 + Math.abs(Math.sin(player.yaw)) * spec.length / 2;
    const extentZ = Math.abs(Math.sin(player.yaw)) * 1.1 + Math.abs(Math.cos(player.yaw)) * spec.length / 2;
    const valleyEdge = player.z > 198 && player.z < 222 && ROADS.every(r => Math.abs(player.x - Math.sin(player.yaw) * spec.length * .32 - r) + extentX > (r > 0 ? 9.8 : r === 0 ? 8.3 : 7.3));
    const wall = valleyEdge&&!PX.lux.shortcut(player);
    if(!PX.career.allowed(player,activeSave())&&PX.career.allowed({x:oldX,z:oldZ},activeSave())){player.x=oldX;player.z=oldZ;player.longitudinal=0;player.lateral=0;notify(text('locked')+' — '+PX.config.districts[PX.career.districtAt({x:oldX+player.vx*dt,z:oldZ+player.vz*dt})]+' €');}
    if (PX.confine(player, spec.length / 2 + 1.5) && performance.now() > edgeNotice) { notify(text('edge')); edgeNotice = performance.now() + 4000; }
    const hit = (PX.lux.height(player)<1&&obstacles.some(o => Math.abs(player.x - Math.sin(player.yaw) * spec.length * .32 - o.x) < o.hx + extentX && Math.abs(player.z - Math.cos(player.yaw) * spec.length * .32 - o.z) < o.hz + extentZ)) ||
      traffic.some(car => car.active && Math.hypot(player.x - Math.sin(player.yaw) * spec.length * .32 - car.x, player.z - Math.cos(player.yaw) * spec.length * .32 - car.z) < radius + car.length * .38);
    if (wall || hit) {
      player.x = oldX; player.z = oldZ; player.vx *= -.2; player.vz *= -.2; player.longitudinal *= -.2; player.lateral *= -.2; player.yawRate *= .3;
      if (Math.hypot(player.vx, player.vz) > .3) crash();
    }
    player.speed = Math.hypot(player.longitudinal, player.lateral || 0); syncPlayer(dt);
  }
  function moveTraffic(dt) {
    trafficSystem.update(dt, player, quality, kind => audio?.trafficHorn(kind));
  }

  function updateHUD() {
    $('points').textContent = Math.floor(score*runMultiplier()).toLocaleString(lang); $('deliveries').textContent = deliveries; $('best').textContent = progress.best.toLocaleString(lang);
    $('walletHud').textContent=progress.wallet.toLocaleString(lang)+' €';$('speedLimit').textContent=PX.lux.limit(player);
    const comboLeft=Math.max(0,PX.config.comboSeconds-(elapsed-combo.last));$('combo').textContent='×'+(comboLeft>0?combo.multiplier:1);$('comboHud').classList.toggle('active',comboLeft>0&&combo.multiplier>1);$('comboBar').value=comboLeft;
    $('speed').textContent = Math.round(player.speed * 3.6); $('vehicleLabel').textContent = activeVehicle().name;
    $('shiftTimer').textContent = mode !== 'free' ? formatTime(SHIFT_SECONDS - elapsed) : '∞';
    const minute=Math.floor((weather==='night'?1260:480)+(elapsed%SHIFT_SECONDS)*.2);
    $('dayClock').textContent = String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
    if (!job) return;
    $('jobKind').textContent=PX.jobs.icons[job.kind]+' '+text(job.kind)+' · '+(job.kind==='bus'?'👥 ':'📦 ')+(job.loads?.[Math.max(0,job.step)]||1)+' · '+text(job.step<0?'pickup':'dropoff');
    $('jobPlace').textContent = target().name; $('distance').textContent = Math.round(distance(player, target())) + ' m' + (job.route.length > 1 ? ' · ' + Math.max(0, job.step) + '/' + job.route.length : '');
    $('jobTime').textContent=(mode!=='free'?formatTime(job.remaining):'∞')+' · '+PX.jobs.pay(job,activeVehicle(),elapsed)+' €';$('jobBar').value=job.kind==='pizza'&&job.pickedAt!==null?Math.max(0,1-(elapsed-job.pickedAt)/PX.config.pizzaSeconds):job.remaining/job.budget;
    $('jobHint').textContent = dwell > 0 ? text(job.step < 0 ? 'loadingParcel' : 'unloading') : text('stop')+(job.kind==='fragile'?' · '+text('damage')+' '+Math.round(job.damage*100)+' %':job.kind==='pizza'?' · '+text('tip'):job.kind==='multi'?' · '+text('pickOrder'):'');
  }
  function drawMap() {
    if (!navigation) return;
    navigation.update(player, job ? target() : null);
    navigation.draw($('minimap'), player, job ? target() : null, obstacles, traffic);
    if (bigMap) navigation.draw($('fullMap'), player, job ? target() : null, obstacles, traffic, true);
    $('streetName').textContent = PX.roadAt(player).name;
  }
  let reviewCamera = null;
  const cameraPos = new THREE.Vector3(), cameraLook = new THREE.Vector3();
  function updateCamera(dt) {
    if (reviewCamera) { camera.position.set(...reviewCamera.slice(0,3)); camera.lookAt(...reviewCamera.slice(3)); return; }
    if (phase === 'menu') {
      demoTime += dt; camera.position.set(-58 + Math.sin(demoTime * .045) * 8, 20, 36); camera.lookAt(-40, 5, -22); return;
    }
    const back = highCamera ? 25 : 13.5 + player.speed * .09, lift = highCamera ? 25 : 7.8;
    cameraPos.set(player.x + Math.sin(player.yaw) * back, lift, player.z + Math.cos(player.yaw) * back);
    camera.position.lerp(cameraPos, 1 - Math.exp(-4 * dt));
    cameraLook.set(player.x - Math.sin(player.yaw) * (6 + player.speed * .2), 1.8, player.z - Math.cos(player.yaw) * (6 + player.speed * .2));
    camera.lookAt(cameraLook); camera.fov += ((highCamera ? 56 : 59 + player.speed * .33) - camera.fov) * (1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix();
  }
  function lighting() {
    const time = weather==='night'?1:.18+Math.min(elapsed/SHIFT_SECONDS,1)*.25;
    const evening = weather==='night'?1:clamp((time - .48) / .27, 0, 1), night = weather==='night'?1:clamp((time - .72) / .22, 0, 1); nightAmount = night;
    const horizon = new THREE.Color('#b9d2d8').lerp(new THREE.Color('#e8b189'), evening).lerp(new THREE.Color('#263d57'), night);
    skyColors.horizon.copy(horizon); skyColors.top.set('#77aac2').lerp(new THREE.Color('#8984a0'), evening).lerp(new THREE.Color('#101d37'), night);
    if(weather==='rain'){horizon.lerp(new THREE.Color('#536d76'),.5);skyColors.top.lerp(new THREE.Color('#344c58'),.55);}
    scene.fog.color.copy(horizon); scene.background.copy(horizon);
    sun.color.set('#fff0d6').lerp(new THREE.Color('#ffb96b'), evening); sun.intensity = (3.1 - evening * .9) * (1 - night * .97); ambient.intensity = 1.55 - night * 1.05;
    ambient.color.set('#dfeaf1').lerp(new THREE.Color('#829bbd'), night);
    sun.position.set(player.x - 35, 65 - evening * 28, player.z - 25); sun.target.position.set(player.x, 0, player.z); sun.target.updateMatrixWorld();
    sky.position.set(camera.position.x, 0, camera.position.z); city.update(player, quality, night, phase === 'menu'); trafficSystem.render(player, quality);
    scene.children.filter(o => o.userData.parked).forEach(o => { o.visible = Math.hypot(o.position.x - player.x, o.position.z - player.z) < 120; });
  }
  function tick(now) {
    animation = 0;
    if (document.hidden) { lastFrame = 0; return; }
    const wallTime = lastFrame ? (now - lastFrame) / 1000 : 0, dt = Math.min(.05, wallTime); lastFrame = now;
    if (phase === 'running' && !paused && !bigMap) {
      // Use unclamped wall time for deadlines, capped simulation steps for stable collisions.
      elapsed += wallTime;saveWait+=wallTime;if(saveWait>=10){save();saveWait=0;} collisionWait = Math.max(0, collisionWait - Math.min(wallTime, .3));
      const simulation = Math.min(wallTime, .25), steps = Math.max(1, Math.ceil(simulation / .025));
      for (let i = 0; i < steps; i++) { moveTraffic(simulation / steps); movePlayer(simulation / steps); }
      // Free driving has no deadline, but its bonus still decays before the 50% payout.
      job.remaining = Math.max(0, job.remaining - wallTime);
      if (mode !== 'free' && elapsed >= SHIFT_SECONDS) end();
      else if(mode==='daily'&&runDay!==PX.missions.day())end();
      else if (mode !== 'free' && job.remaining <= 0) { combo=PX.jobs.emptyCombo();notify(text('failed')); newJob(); }
      else if (distance(player, target()) < STOP_RADIUS && player.speed < PX.config.stopSpeed) { dwell += Math.min(wallTime, .25); if (dwell >= PX.config.stopDwell) completeStop(); }
      else dwell = 0;
      if(input.has('drift')&&Math.abs(player.slip)>.1)mission('drift',player.speed*simulation);
      const fine=luxWorld.cameraFine(player,elapsed);if(fine){progress={...progress,wallet:Math.max(0,progress.wallet-fine)};save();notify('📸 '+text('fine')+' · −'+fine+' €');$('game').classList.add('flash');setTimeout(()=>$('game').classList.remove('flash'),180);}
      const star=luxWorld.collect(player,progress);if(star){progress={...progress,stars:[...progress.stars,star.id]};award(PX.config.starReward);notify('⭐ '+text('starFound')+' · +'+PX.config.starReward+' €');}
      beacon.children[0].position.y = 10 + Math.sin(now * .004) * .6;
    }
    if (phase === 'menu') moveTraffic(dt);
    luxWorld.update(player,progress,weather,dt,now);
    if (!paused && !bigMap) updateCamera(dt); lighting();
    hudWait += dt; if (hudWait >= .1) { updateHUD(); drawMap(); hudWait = 0; }
    if (noticeUntil && now > noticeUntil) { $('notice').textContent = ''; noticeUntil = 0; }
    if (audio) audio.update(player, activeVehicle(), phase === 'running' && !paused && !bigMap, muted, input.has('drift'));
    renderer.render(scene, camera); requestRender();
  }
  function requestRender() { if (!animation && !document.hidden && renderer) animation = requestAnimationFrame(tick); }
  const KEYS = Object.freeze({ w: 'gas', ArrowUp: 'gas', s: 'brake', ArrowDown: 'brake', a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right', ' ': 'drift' });
  function actions(key) {
    if (key === 'n' || (key === 'Escape' && bigMap)) mapToggle();
    if (key === 'p') pauseToggle(); if (key === 'm') muteToggle();
    if (phase !== 'running' || paused) return;
    if (key === 'c') highCamera = !highCamera; if (key === 'r') resetRoad(); if (key === 'h') horn(true);
  }
  window.addEventListener('keydown', event => {
    if (event.target.matches('input,select,textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (KEYS[key] && phase === 'running') { event.preventDefault(); if (!paused && !bigMap) input.add(KEYS[key]); }
    if (!event.repeat) actions(key);
  });
  window.addEventListener('keyup', event => { const key = event.key.length === 1 ? event.key.toLowerCase() : event.key; if (KEYS[key]) input.delete(KEYS[key]); if (key === 'h' && audio) audio.horn(false, vehicle()); });
  window.addEventListener('blur', () => { clearInput(); if (phase === 'running' && !paused) pauseToggle(); });
  document.querySelectorAll('[data-input]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); if (phase !== 'running' || paused || bigMap) return; soundStart(); button.setPointerCapture(event.pointerId);
      heldPointers.set(event.pointerId, button.dataset.input); input.add(button.dataset.input); button.classList.add('on');
    });
    const release = event => { heldPointers.delete(event.pointerId); if (![...heldPointers.values()].includes(button.dataset.input)) { input.delete(button.dataset.input); button.classList.remove('on'); } };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
  });
  $('startDaily').addEventListener('click',()=>start('daily'));$('retryDaily').addEventListener('click',submitDaily);
  $('trafficSetting').addEventListener('change',event=>{trafficSetting=event.target.value;runTraffic=trafficSetting;try{localStorage.setItem('px_traffic',trafficSetting);}catch(error){warn('Traffic preference save failed',error);}trafficSystem.configure(trafficSetting);refreshGarage();});
  $('startShift').addEventListener('click', () => start('shift')); $('startFree').addEventListener('click', () => start('free'));
  $('again').addEventListener('click', () => start(mode)); $('finish').addEventListener('click', end); $('pause').addEventListener('click', pauseToggle); $('resume').addEventListener('click', pauseToggle);
  $('camera').addEventListener('click', () => actions('c')); $('reset').addEventListener('click', () => actions('r')); $('horn').addEventListener('pointerdown', event => { if (phase !== 'running' || paused) return; event.preventDefault(); $('horn').setPointerCapture(event.pointerId); horn(true); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(event => $('horn').addEventListener(event, () => { if (audio) audio.horn(false, activeVehicle()); })); $('mute').addEventListener('click', muteToggle);
  $('quality').addEventListener('click', () => { quality = ['high', 'medium', 'low'][(['high', 'medium', 'low'].indexOf(quality) + 1) % 3]; try { localStorage.setItem('px_quality', quality); } catch (error) { warn('Quality save failed', error); } updateQuality(); });
  $('minimap').addEventListener('click', mapToggle); $('minimap').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mapToggle(); } }); $('closeMap').addEventListener('click', mapToggle);
  $('toGarage').addEventListener('click', () => { phase = 'menu'; $('endScreen').hidden = true; $('menu').hidden = false; beacon.visible = false; beaconRing.visible = false; weather=forecast();refreshGarage();loadBoard(); });
  document.querySelectorAll('[data-lang]').forEach(button => button.addEventListener('click', () => {
    lang = button.dataset.lang; try { localStorage.setItem('site_lang', lang); } catch (error) { warn('Language preference save failed', error); } translate();
  }));
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== HOST_ORIGIN) return;
    if (event.data?.__pbLoadSave === 1) { mergeSave(event.data.data); save(); if (phase !== 'running' && scene) replacePlayer(); }
    if (event.data?.__pbSndMute !== undefined) { muted = !!event.data.__pbSndMute; updateMute(); }
  });
  window.addEventListener('storage', event => {
    if (event.key === SAVE_KEY) { try { mergeSave(JSON.parse(event.newValue || 'null')); } catch (error) { warn('Shared progress read failed', error); } }
    theme();
  });
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearInput(); if (phase === 'running' && !paused) pauseToggle(); cancelAnimationFrame(animation); animation = 0; lastFrame = 0; if (audio) audio.master.gain.value = 0; save(); }
    else { lastFrame = 0; requestRender(); }
  });
  new ResizeObserver(resize).observe($('game'));
  Arcade.onMute(value => { muted = value; updateMute(); }); Arcade.onRestart(() => start(mode));
  const storedLang = readStore('site_lang'); if (TEXT[storedLang]) lang = storedLang;
  try { mergeSave(window.__pbSave || JSON.parse(readStore(SAVE_KEY) || 'null')); }
  catch (error) { warn('Progress restore failed', error); notify(text('saveError')); }
  theme(); translate(); init3D();trafficSystem?.configure(trafficSetting);loadBoard();
  post({ __pbWantSave: 1 });
  // Debug access is explicitly opt-in, including when launched inside the hub's srcdoc frame.
  try {
    const test = new URL(location.href).searchParams.get('test') === '1' || (parent !== window && new URL(parent.location.href).searchParams.get('test') === '1');
    if (test) window.__pxTest = Object.freeze({
      state: () => ({ runVehicle:activeVehicle().id,cargoSlots:activeVehicle().stops,wallet:progress.wallet,tb:progress.tb,owned:progress.owned,districts:progress.districts,upgrades:progress.upgrades,jobKind:job?.kind,damage:job?.damage,pay:job?PX.jobs.pay(job,activeVehicle(),elapsed):0,combo:combo.multiplier,trafficSetting,trafficMultiplier:runMultiplier(),weather,dailyIndex,dailyDay:runDay,shiftCash,stars:progress.stars.length,phase, mode, paused, score, deliveries, elapsed, lifetime: progress.lifetime, best: progress.best, vehicle: vehicle().id, step: job?.step, elevation:PX.lux.height(player),jobStops:job?.route.length,jobCompleted:job?.completed.length,jobTargets:job?[job.pickup,...job.route]:[],crashes,penalties: job?.penalties, position: { x: player.x, z: player.z }, input: [...input], draws: renderer?.info.render.calls, steering: player.steering || 0, frontSteer: wheelAngle(0), rearSteer: wheelAngle(2), yaw: player.yaw, speed: player.speed, wheelSpin: playerMesh?.userData.wheelSpin, route: navigation?.route, routeVisible: navigation?.mesh.visible, bigMap, quality, places: PLACES.length, gear: audio?.gear, audioStarted: !!audio, hornHeld: !!audio?.hornHeld, muted, masterGain: audio?.master.gain.value, night: nightAmount, signChecks: city?.signChecks, landmarks: city?.landmarks, traffic: trafficSystem?.stats(), signals: trafficSystem?.signals(), slip: player.slip, yawRate: player.yawRate, rearRelease: player.rearRelease, playableEdge: WORLD_EDGE }),
      teleport: () => { if (phase !== 'running') return; const place = target(); Object.assign(player, { x: place.x, z: place.z, vx: 0, vz: 0, speed: 0, longitudinal: 0, slip: 0, lateral: 0, yawRate: 0, steering: 0, rearRelease: 0 }); dwell = 0; collisionWait = 2; syncPlayer(); },
      pose: (x, z, yaw = Math.PI / 2) => { reviewCamera = null; Object.assign(player, { x, z, yaw, vx: 0, vz: 0, speed: 0, longitudinal: 0, slip: 0, lateral: 0, yawRate: 0, steering: 0, rearRelease: 0 }); syncPlayer(); navigation.update(player, job ? target() : null, true); camera.position.set(x + Math.sin(yaw) * 15, 8, z + Math.cos(yaw) * 15); },
      view: view => { reviewCamera = view; },
      clock: time => { elapsed = time; lighting(); },
      driveSample: (id, speed, steps) => {
        const spec = VEHICLES.find(v => v.id === id), p = {x:0,z:0,yaw:0,longitudinal:speed};
        return steps.map(({keys,seconds}) => {for(let i=0;i<Math.ceil(seconds*120);i++)PX.drive(p,spec,new Set(keys),1/120);return {...p};});
      },
      driveTrial: (id = 'auto', speed = 16, counter = true) => {
        const spec = VEHICLES.find(v => v.id === id), p = {x:0,z:0,yaw:0,longitudinal:speed};
        const step = (keys,seconds) => { for(let t=0;t<seconds;t+=1/120) PX.drive(p,spec,new Set(keys),1/120); return {...p}; };
        const entry=step(['gas','left'],.6), slide=step(['gas','left','drift'],1.25);
        const release=step(counter?['gas','right']:['gas'],.12), caught=step(counter?['gas','right']:['gas'],.55), settled=step(['gas'],1.4);
        return {entry,slide,release,caught,settled};
      },
      boundaryTrial: () => {
        const results=[];
        for(const [x,z,yaw] of [[280,0,-Math.PI/2],[-280,0,Math.PI/2],[0,280,Math.PI],[0,-280,0],[280,280,-Math.PI*.75]]) {
          const p={x,z,yaw,longitudinal:24}; let max=0;
          for(let i=0;i<480;i++){PX.drive(p,VEHICLES[0],new Set(['gas']),1/60);PX.confine(p,4);max=Math.max(max,Math.abs(p.x),Math.abs(p.z));}
          results.push({max,x:p.x,z:p.z,speed:p.speed});
        }
        return results;
      },
      trafficTrial: seconds => { for(let t=0;t<seconds;t+=.025) trafficSystem.update(.025,{x:0,z:-600,yaw:0},quality); return trafficSystem.stats(); },
      trafficBlockTrial: () => trafficSystem.blockTrial(),
      bumpTraffic: () => {
        const c=traffic.find(c=>c.active&&!c.turn);const yaw=c.yaw||0;
        Object.assign(player,{x:c.x+Math.sin(yaw)*vehicle().length*.32,z:c.z+Math.cos(yaw)*vehicle().length*.32,yaw,longitudinal:14,lateral:0,yawRate:0,steering:0});collisionWait=0;
      },
      trafficCars: () => traffic.filter(c=>c.active).map(c=>({x:c.x,z:c.z,road:c.road,kind:c.kind,speed:c.speed,yaw:c.yaw,stopReason:c.stopReason,turn:!!c.turn})),
      weather:value=>{if(['sunny','rain','night'].includes(value)){weather=value;lighting();}},forceJob:kind=>newJob(kind),crash:()=>{collisionWait=0;crash();},purchase,missions:date=>PX.missions.list(date),dailyRoute:date=>PX.daily.route(date),lockedRoute:()=>PX.route(player,{x:130,z:-165,district:'Kirchberg'}),chooseDrop,radarTrial:()=>{const fine=PX.lux.fine({x:-115,z:3},20);progress={...progress,wallet:Math.max(0,progress.wallet-fine)};save();return fine;},resumeTraffic:()=>trafficSystem.configure(runTraffic,null,job?[job.pickup,...job.route]:[]),radarPose:()=>{luxWorld.reset();trafficSystem.configure('off',null,job?[job.pickup,...job.route]:[]);Object.assign(player,{x:-115,z:3,speed:20,longitudinal:20,yaw:Math.PI/2});},
      end, expireJob: () => { if (job && mode === 'shift') job.remaining = 0; },
      merge: data => { mergeSave(data); save(); if (phase !== 'running' && scene) replacePlayer(); },
    });
  } catch (error) { warn('Test query read failed', error); }
})();
