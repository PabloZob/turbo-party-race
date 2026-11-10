/**
 * ============================================================================
 * TURBO PARTY RACE — MANETTE MOBILE (iOS Safari & Android Chrome)
 * - Reconnexion transparente 4G/5G via playerToken (sessionStorage / localStorage)
 * - Lecture Multi-Touch par coordonnées (elementFromPoint + BoundingRects)
 * - Glissement continu Gauche <-> Droite + Multi-pédales Accélérer + Drift
 * - Retour Haptique Hybride : Androidibrate + iOS 17.4+ Taptic Switch + Flash + WebAudio
 * ============================================================================
 */

(function () {
  'use strict';

  // --------------------------------------------------------------------------
  // 1. IDENTIFIANT PERSISTANT (RECONNEXION 4G/5G 10 SECONDES)
  // --------------------------------------------------------------------------
  const TOKEN_KEY = 'partyRacePlayerToken';
  const NAME_KEY = 'partyRacePlayerName';
  const ROOM_KEY = 'partyRaceRoomCode';

  function getOrCreatePlayerToken() {
    let token = null;
    try {
      token = sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
      if (!token) {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          token = window.crypto.randomUUID();
        } else {
          token = 'plr-' + Math.random().toString(36).slice(2, 11) + '-' + Date.now().toString(36);
        }
      }
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_KEY, token);
    } catch (_e) {
      token = 'plr-' + Math.random().toString(36).slice(2, 11);
    }
    return token;
  }

  const playerToken = getOrCreatePlayerToken();

  // --------------------------------------------------------------------------
  // 2. RÉFÉRENCES DOM
  // --------------------------------------------------------------------------
  const joinScreen = document.getElementById('join-screen');
  const controllerScreen = document.getElementById('controller-screen');
  const joinForm = document.getElementById('join-form');
  const roomInput = document.getElementById('room-input');
  const nameInput = document.getElementById('name-input');
  const joinError = document.getElementById('join-error');
  const joinBtn = document.getElementById('join-btn');

  const portraitOverlay = document.getElementById('portrait-overlay');
  const dismissPortraitBtn = document.getElementById('dismiss-portrait-btn');

  const telemetryBar = document.getElementById('telemetry-bar');
  const playerColorDot = document.getElementById('player-color-dot');
  const playerNameLabel = document.getElementById('player-name-label');
  const connectionDot = document.getElementById('connection-dot');
  const telemetryPosition = document.getElementById('telemetry-position');
  const telemetryLap = document.getElementById('telemetry-lap');
  const creatorActionBtn = document.getElementById('creator-action-btn');
  const hornBtn = document.getElementById('horn-btn');

  const raceStatusBanner = document.getElementById('race-status-banner');
  const btnItem = document.getElementById('btn-item');
  const itemIcon = document.getElementById('item-icon');
  const itemLabel = document.getElementById('item-label');
  const itemSub = document.getElementById('item-sub');

  const btnLeft = document.getElementById('btn-left');
  const btnRight = document.getElementById('btn-right');
  const btnAccel = document.getElementById('btn-accel');
  const btnDrift = document.getElementById('btn-drift');

  const iosHapticLabel = document.getElementById('ios-haptic-label');
  const hapticFlash = document.getElementById('haptic-flash');

  // --------------------------------------------------------------------------
  // 3. ÉTAT LOCAL DE LA MANETTE
  // --------------------------------------------------------------------------
  let hasJoinedRoom = false;
  let currentRoomCode = '';
  let currentPlayerName = '';
  let isCreator = false;
  let roomStatus = 'lobby'; // 'lobby' | 'countdown' | 'racing' | 'finished'
  let currentItem = null;   // 'nitro' | 'oil' | 'shockwave' | null
  let totalLaps = 3;

  const inputState = {
    left: false,
    right: false,
    accel: false,
    drift: false
  };

  // Suivi souris / clavier pour tester aussi sur ordinateur
  let mouseActiveControl = null;
  const keyState = {
    left: false,
    right: false,
    accel: false,
    drift: false
  };

  // --------------------------------------------------------------------------
  // 4. MICRO-SYNTHÉTISEUR AUDIO & HAPTIQUE (iOS + ANDROID)
  // --------------------------------------------------------------------------
  let audioCtx = null;

  function unlockMobileAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtx) {
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch (_e) {
      // Ignorer si Web Audio non supporté
    }
  }

  function playControllerTone(type) {
    if (!audioCtx || audioCtx.state !== 'running') return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'pickup') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.14);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      } else if (type === 'boost') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(640, now + 0.18);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === 'horn') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(554, now + 0.07);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.16);
      } else {
        // Collision / impact
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(55, now + 0.12);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
        osc.start(now);
        osc.stop(now + 0.13);
      }
    } catch (_e) {
      // Ignorer erreurs audio
    }
  }

  let flashTimeout = null;

  /**
   * Déclenche un retour haptique universel :
   * 1. Android : navigator.vibrate(pattern)
   * 2. iOS 17.4+ Safari : bascule du switch caché (<input type="checkbox" switch>)
   * 3. Visuel : flash néon autour de la manette
   * 4. Sonore : micro-impulsion Web Audio
   */
  function triggerHaptic(pattern = [35], type = 'impact') {
    // 1. Vibration native Android
    try {
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch (_e) {
      // Ignoré sur iOS
    }

    // 2. Astuce Taptic Engine Safari iOS 17.4+
    try {
      if (iosHapticLabel) {
        iosHapticLabel.click();
      }
    } catch (_e) {
      // Ignoré
    }

    // 3. Flash visuel de bordure d'écran
    if (hapticFlash) {
      hapticFlash.classList.remove('active-hit', 'active-boost', 'active-item');
      void hapticFlash.offsetWidth; // Reflow
      if (type === 'boost' || type === 'nitro') {
        hapticFlash.classList.add('active-boost');
      } else if (type === 'item' || type === 'pickup') {
        hapticFlash.classList.add('active-item');
      } else {
        hapticFlash.classList.add('active-hit');
      }
      if (flashTimeout) clearTimeout(flashTimeout);
      flashTimeout = setTimeout(() => {
        hapticFlash.classList.remove('active-hit', 'active-boost', 'active-item');
      }, 220);
    }

    // 4. Micro-retour sonore
    playControllerTone(type);
  }

  // --------------------------------------------------------------------------
  // 5. PRÉ-REMPLISSAGE DU FORMULAIRE (?room=XXXX + localStorage)
  // --------------------------------------------------------------------------
  function initJoinForm() {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = (params.get('room') || '').trim().toUpperCase().slice(0, 4);

    let savedRoom = '';
    let savedName = '';
    try {
      savedRoom = (sessionStorage.getItem(ROOM_KEY) || '').trim().toUpperCase();
      savedName = (localStorage.getItem(NAME_KEY) || '').trim();
    } catch (_e) {
      // Ignorer
    }

    if (urlRoom) {
      roomInput.value = urlRoom;
    } else if (savedRoom) {
      roomInput.value = savedRoom;
    }

    if (savedName) {
      nameInput.value = savedName;
    }

    roomInput.addEventListener('input', () => {
      roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      hideError();
    });

    nameInput.addEventListener('input', () => {
      hideError();
    });
  }

  function showError(msg) {
    if (!joinError) return;
    joinError.textContent = msg;
    joinError.hidden = false;
  }

  function hideError() {
    if (!joinError) return;
    joinError.hidden = true;
    joinError.textContent = '';
  }

  // --------------------------------------------------------------------------
  // 6. CONNEXION SOCKET.IO & RECONNEXION AUTOMATIQUE
  // --------------------------------------------------------------------------
  const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 2500
  });

  socket.on('connect', () => {
    if (connectionDot) {
      connectionDot.classList.remove('offline');
      connectionDot.classList.add('online');
    }

    // Si le joueur était déjà en course et que la 4G/5G a coupé/repris, on le reconnecte immédiatement !
    if (hasJoinedRoom && currentRoomCode && currentPlayerName) {
      socket.emit('player:join', {
        roomCode: currentRoomCode,
        name: currentPlayerName,
        playerToken
      });
    }
  });

  socket.on('disconnect', () => {
    if (connectionDot) {
      connectionDot.classList.remove('online');
      connectionDot.classList.add('offline');
    }
    resetControlsState();
  });

  // Soumission du formulaire de connexion
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    unlockMobileAudio();

    const code = (roomInput.value || '').trim().toUpperCase();
    const name = (nameInput.value || '').trim().slice(0, 12);

    if (code.length !== 4) {
      showError('Veuillez entrer le code salon à 4 lettres affiché sur la TV.');
      return;
    }
    if (!name) {
      showError('Veuillez choisir un pseudo de pilote !');
      return;
    }

    hideError();
    joinBtn.disabled = true;
    joinBtn.textContent = 'CONNEXION EN COURS...';

    currentRoomCode = code;
    currentPlayerName = name;

    try {
      sessionStorage.setItem(ROOM_KEY, code);
      localStorage.setItem(NAME_KEY, name);
    } catch (_err) {
      // Ignorer
    }

    // Tenter de passer en plein écran / verrouiller l'orientation paysage sur Android Chrome
    try {
      if (document.documentElement.requestFullscreen && window.innerHeight > window.innerWidth) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } catch (_e) {
      // Non supporté sur iOS Safari, géré par l'overlay portrait
    }

    socket.emit('player:join', {
      roomCode: code,
      name,
      playerToken
    });
  });

  // Confirmation de connexion au salon
  socket.on('player:joined', (res) => {
    joinBtn.disabled = false;
    joinBtn.textContent = '🏎️ REJOINDRE LA COURSE';

    if (!res || !res.ok) {
      showError((res && res.error) || 'Impossible de rejoindre ce salon.');
      if (!hasJoinedRoom) {
        switchToJoinScreen();
      }
      return;
    }

    hasJoinedRoom = true;
    hideError();

    // Retirer le focus des champs texte pour fermer le clavier mobile
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }

    switchToControllerScreen();

    if (res.player) {
      applyPlayerIdentity(res.player);
    }
    if (res.state) {
      applyRoomState(res.state);
    }

    triggerHaptic([30, 40, 60], 'boost');
  });

  // Mise à jour globale de l'état du salon
  socket.on('room:state', (state) => {
    applyRoomState(state);
  });

  socket.on('race:start', (state) => {
    applyRoomState(state);
    triggerHaptic([50, 40, 80], 'boost');
  });

  socket.on('race:reset', (state) => {
    currentItem = null;
    updateItemButton(null);
    applyRoomState(state);
    triggerHaptic([30], 'item');
  });

  socket.on('race:finished', (payload) => {
    if (payload && payload.state) {
      applyRoomState(payload.state);
    } else if (payload) {
      applyRoomState(payload);
    }
    triggerHaptic([60, 50, 60, 50, 120], 'boost');
  });

  // Télémétrie temps réel (position, tour, bonus, créateur)
  socket.on('player:telemetry', (telemetry) => {
    if (!telemetry) return;

    if (telemetry.color || telemetry.name || typeof telemetry.isCreator === 'boolean') {
      applyPlayerIdentity(telemetry);
    }

    if (typeof telemetry.position === 'number') {
      telemetryPosition.textContent = formatRank(telemetry.position);
    }

    if (typeof telemetry.lap === 'number') {
      const clampedLap = Math.min(Math.max(1, telemetry.lap), totalLaps);
      telemetryLap.textContent = `${clampedLap}/${totalLaps}`;
    }

    // Détecter si un nouvel objet bonus vient d'être ramassé
    const previousItem = currentItem;
    const nextItem = telemetry.item || null;
    if (previousItem !== nextItem) {
      currentItem = nextItem;
      updateItemButton(nextItem);
      if (previousItem === null && nextItem !== null) {
        triggerHaptic([40, 30, 70], 'pickup');
      }
    }

    if (telemetry.status && telemetry.status !== roomStatus) {
      roomStatus = telemetry.status;
      updateStatusUI();
    }

    if (telemetry.finished && roomStatus === 'racing') {
      raceStatusBanner.textContent = `🏁 ARRIVÉ (${formatRank(telemetry.position)}) !`;
      raceStatusBanner.className = 'race-status-banner status-finished';
    }
  });

  // Retour haptique déclenché par le moteur physique sur la TV (collisions, flaques d'huile, etc.)
  socket.on('controller:haptic', (data) => {
    const pattern = (data && Array.isArray(data.pattern) && data.pattern.length > 0)
      ? data.pattern
      : [45];
    const type = (data && data.type) ? data.type : 'impact';
    triggerHaptic(pattern, type);
  });

  // Fermeture du salon par l'écran TV
  socket.on('room:closed', (data) => {
    hasJoinedRoom = false;
    resetControlsState();
    switchToJoinScreen();
    showError((data && data.message) || 'Le salon a été fermé par l’écran principal.');
  });

  // --------------------------------------------------------------------------
  // 7. MISE À JOUR DE L'INTERFACE DE LA MANETTE
  // --------------------------------------------------------------------------
  function switchToControllerScreen() {
    joinScreen.hidden = true;
    joinScreen.classList.remove('active');
    controllerScreen.hidden = false;
    controllerScreen.classList.add('active');
  }

  function switchToJoinScreen() {
    controllerScreen.hidden = true;
    controllerScreen.classList.remove('active');
    joinScreen.hidden = false;
    joinScreen.classList.add('active');
  }

  function formatRank(pos) {
    if (!pos || pos < 1) return '--';
    return pos === 1 ? '1er' : `${pos}e`;
  }

  function applyPlayerIdentity(player) {
    if (player.color) {
      document.documentElement.style.setProperty('--player-color', player.color);
      if (playerColorDot) {
        playerColorDot.style.background = player.color;
        playerColorDot.style.boxShadow = `0 0 10px ${player.color}`;
      }
      if (telemetryBar) {
        telemetryBar.style.borderColor = player.color;
      }
    }

    if (player.name && playerNameLabel) {
      playerNameLabel.textContent = player.name.toUpperCase();
    }

    if (typeof player.isCreator === 'boolean') {
      isCreator = player.isCreator;
      updateCreatorButton();
    }
  }

  function applyRoomState(rawState) {
    if (!rawState) return;
    const state = rawState.state || rawState;

    if (state.status) {
      roomStatus = state.status;
    }

    if (Array.isArray(state.players)) {
      const me = state.players.find((p) => p.id === playerToken);
      if (me) {
        applyPlayerIdentity(me);
        if (typeof me.position === 'number') {
          telemetryPosition.textContent = formatRank(me.position);
        }
        if (typeof me.lap === 'number') {
          telemetryLap.textContent = `${Math.min(Math.max(1, me.lap), totalLaps)}/${totalLaps}`;
        }
        if (me.item !== undefined && me.item !== currentItem) {
          currentItem = me.item;
          updateItemButton(currentItem);
        }
      }
    }

    updateStatusUI();
    updateCreatorButton();
  }

  function updateStatusUI() {
    if (!raceStatusBanner) return;
    raceStatusBanner.className = 'race-status-banner';

    if (roomStatus === 'lobby') {
      raceStatusBanner.textContent = isCreator
        ? 'VOUS ÊTES L’HÔTE : LANCEZ LA PARTIE !'
        : 'EN ATTENTE DU DÉPART SUR LA TV...';
    } else if (roomStatus === 'countdown') {
      raceStatusBanner.textContent = '🚦 PRÉPAREZ-VOUS AU DÉPART !';
      raceStatusBanner.classList.add('status-racing');
    } else if (roomStatus === 'racing') {
      raceStatusBanner.textContent = '🔥 COURSE EN COURS — FONCEZ !';
      raceStatusBanner.classList.add('status-racing');
    } else if (roomStatus === 'finished') {
      raceStatusBanner.textContent = '🏆 COURSE TERMINÉE !';
      raceStatusBanner.classList.add('status-finished');
    }
  }

  function updateCreatorButton() {
    if (!creatorActionBtn) return;

    if (!isCreator) {
      creatorActionBtn.hidden = true;
      return;
    }

    if (roomStatus === 'lobby') {
      creatorActionBtn.hidden = false;
      creatorActionBtn.textContent = '🏁 LANCER LA PARTIE';
    } else if (roomStatus === 'finished') {
      creatorActionBtn.hidden = false;
      creatorActionBtn.textContent = '🔄 REJOUER';
    } else {
      creatorActionBtn.hidden = true;
    }
  }

  function updateItemButton(item) {
    if (!btnItem) return;

    btnItem.classList.remove('empty', 'ready', 'item-nitro', 'item-oil', 'item-shockwave');

    if (!item) {
      btnItem.disabled = true;
      btnItem.classList.add('empty');
      itemIcon.textContent = '🎲';
      itemLabel.textContent = 'AUCUN BONUS';
      itemSub.textContent = 'Traversez un cube mystère';
      return;
    }

    btnItem.disabled = false;
    btnItem.classList.add('ready');

    if (item === 'nitro') {
      btnItem.classList.add('item-nitro');
      itemIcon.textContent = '🔥';
      itemLabel.textContent = 'NITRO !';
      itemSub.textContent = 'APPUYEZ POUR TURBO BOOST';
    } else if (item === 'oil') {
      btnItem.classList.add('item-oil');
      itemIcon.textContent = '🍌';
      itemLabel.textContent = 'HUILE !';
      itemSub.textContent = 'LÂCHER UN PIÈGE GLISSANT';
    } else if (item === 'shockwave') {
      btnItem.classList.add('item-shockwave');
      itemIcon.textContent = '⚡';
      itemLabel.textContent = 'ONDE DE CHOC !';
      itemSub.textContent = 'ÉLECTROCUTER LES RIVAUX';
    }
  }

  // --------------------------------------------------------------------------
  // 8. GESTION MULTI-TOUCH IRRÉPROCHABLE PAR COORDONNÉES
  // --------------------------------------------------------------------------
  const controlElements = [
    { key: 'left', el: btnLeft },
    { key: 'right', el: btnRight },
    { key: 'accel', el: btnAccel },
    { key: 'drift', el: btnDrift }
  ];

  // Stocke les touches actives pour une évaluation continue sans conflit
  let activeTouches = [];

  function isPointInsideRect(x, y, rect, margin = 6) {
    return (
      x >= rect.left - margin &&
      x <= rect.right + margin &&
      y >= rect.top - margin &&
      y <= rect.bottom + margin
    );
  }

  /**
   * Parcourt tous les doigts posés sur l'écran (via elementFromPoint + BoundingClientRect)
   * afin de permettre :
   * 1. Le glissement fluide du pouce gauche entre GAUCHE et DROITE sans lever le doigt.
   * 2. L'appui simultané du pouce droit sur ACCÉLÉRER + FREIN/DRIFT + BONUS.
   */
  function evaluateMultiTouchState() {
    const nextState = {
      left: Boolean(keyState.left || mouseActiveControl === 'left'),
      right: Boolean(keyState.right || mouseActiveControl === 'right'),
      accel: Boolean(keyState.accel || mouseActiveControl === 'accel'),
      drift: Boolean(keyState.drift || mouseActiveControl === 'drift')
    };

    if (activeTouches.length > 0) {
      const rects = {
        left: btnLeft ? btnLeft.getBoundingClientRect() : null,
        right: btnRight ? btnRight.getBoundingClientRect() : null,
        accel: btnAccel ? btnAccel.getBoundingClientRect() : null,
        drift: btnDrift ? btnDrift.getBoundingClientRect() : null
      };

      for (let i = 0; i < activeTouches.length; i++) {
        const t = activeTouches[i];
        const x = t.clientX;
        const y = t.clientY;

        // Méthode 1 : document.elementFromPoint
        const hitEl = document.elementFromPoint(x, y);
        if (hitEl) {
          const ctrlBtn = hitEl.closest('[data-control]');
          if (ctrlBtn) {
            const ctrlName = ctrlBtn.getAttribute('data-control');
            if (ctrlName && ctrlName in nextState) {
              nextState[ctrlName] = true;
              continue;
            }
          }
        }

        // Méthode 2 : vérification géométrique avec tolérance (glissement de pouce)
        if (rects.left && isPointInsideRect(x, y, rects.left, 8)) {
          nextState.left = true;
        } else if (rects.right && isPointInsideRect(x, y, rects.right, 8)) {
          nextState.right = true;
        }

        if (rects.accel && isPointInsideRect(x, y, rects.accel, 8)) {
          nextState.accel = true;
        }
        if (rects.drift && isPointInsideRect(x, y, rects.drift, 8)) {
          nextState.drift = true;
        }
      }
    }

    // Empêcher Gauche + Droite simultanés si un seul doigt est entre les deux
    if (nextState.left && nextState.right && activeTouches.length === 1) {
      const t = activeTouches[0];
      const leftRect = btnLeft.getBoundingClientRect();
      const rightRect = btnRight.getBoundingClientRect();
      const midX = (leftRect.right + rightRect.left) / 2;
      if (t.clientX < midX) {
        nextState.right = false;
      } else {
        nextState.left = false;
      }
    }

    applyAndSendInputState(nextState);
  }

  function applyAndSendInputState(nextState) {
    let changed = false;

    for (const item of controlElements) {
      const k = item.key;
      const isPressed = Boolean(nextState[k]);
      if (inputState[k] !== isPressed) {
        inputState[k] = isPressed;
        changed = true;
        if (item.el) {
          item.el.classList.toggle('active', isPressed);
        }
      }
    }

    if (changed) {
      emitPlayerInput();
    }
  }

  function emitPlayerInput() {
    if (!hasJoinedRoom || !currentRoomCode) return;
    socket.emit('player:input', {
      roomCode: currentRoomCode,
      playerToken,
      input: {
        left: inputState.left,
        right: inputState.right,
        accel: inputState.accel,
        drift: inputState.drift
      }
    });
  }

  function resetControlsState() {
    activeTouches = [];
    mouseActiveControl = null;
    keyState.left = false;
    keyState.right = false;
    keyState.accel = false;
    keyState.drift = false;
    applyAndSendInputState({
      left: false,
      right: false,
      accel: false,
      drift: false
    });
  }

  // Rafraîchissement de sécurité toutes les 150ms tant qu'un bouton est maintenu
  setInterval(() => {
    if (!hasJoinedRoom) return;
    if (inputState.left || inputState.right || inputState.accel || inputState.drift) {
      emitPlayerInput();
    }
  }, 150);

  // Écouteurs Touch globaux sur l'écran manette
  function handleTouchUpdate(e) {
    if (controllerScreen.hidden) return;

    // Laisser les boutons d'action ponctuels (Bonus, Klaxon, Lancer, Continuer) fonctionner
    const target = e.target;
    const isActionTap =
      target &&
      (target.closest('#btn-item') ||
        target.closest('#horn-btn') ||
        target.closest('#creator-action-btn') ||
        target.closest('#dismiss-portrait-btn'));

    if (!isActionTap && e.cancelable) {
      e.preventDefault();
    }

    unlockMobileAudio();
    activeTouches = Array.from(e.touches || []);
    evaluateMultiTouchState();
  }

  controllerScreen.addEventListener('touchstart', handleTouchUpdate, { passive: false });
  controllerScreen.addEventListener('touchmove', handleTouchUpdate, { passive: false });
  controllerScreen.addEventListener('touchend', handleTouchUpdate, { passive: false });
  controllerScreen.addEventListener('touchcancel', handleTouchUpdate, { passive: false });

  // Fallback Souris (pour tester la manette sur ordinateur)
  for (const item of controlElements) {
    if (!item.el) continue;
    item.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      unlockMobileAudio();
      mouseActiveControl = item.key;
      evaluateMultiTouchState();
    });
    item.el.addEventListener('mouseenter', (e) => {
      if (e.buttons === 1 && (item.key === 'left' || item.key === 'right')) {
        mouseActiveControl = item.key;
        evaluateMultiTouchState();
      }
    });
  }

  window.addEventListener('mouseup', () => {
    if (mouseActiveControl !== null) {
      mouseActiveControl = null;
      evaluateMultiTouchState();
    }
  });

  // Fallback Clavier (Flèches / ZQSD / Espace pour tester sur PC)
  window.addEventListener('keydown', (e) => {
    if (controllerScreen.hidden) return;
    if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q' || e.key === 'a' || e.key === 'A') {
      keyState.left = true;
      evaluateMultiTouchState();
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      keyState.right = true;
      evaluateMultiTouchState();
    } else if (e.key === 'ArrowUp' || e.key === 'z' || e.key === 'Z' || e.key === 'w' || e.key === 'W') {
      keyState.accel = true;
      evaluateMultiTouchState();
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' || e.key === 'Shift') {
      keyState.drift = true;
      evaluateMultiTouchState();
    } else if (e.key === ' ') {
      useBonusItem();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (controllerScreen.hidden) return;
    if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q' || e.key === 'a' || e.key === 'A') {
      keyState.left = false;
      evaluateMultiTouchState();
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      keyState.right = false;
      evaluateMultiTouchState();
    } else if (e.key === 'ArrowUp' || e.key === 'z' || e.key === 'Z' || e.key === 'w' || e.key === 'W') {
      keyState.accel = false;
      evaluateMultiTouchState();
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' || e.key === 'Shift') {
      keyState.drift = false;
      evaluateMultiTouchState();
    }
  });

  // --------------------------------------------------------------------------
  // 9. ACTIONS PONCTUELLES : BONUS, KLAXON, CRÉATEUR, OVERLAY PORTRAIT
  // --------------------------------------------------------------------------
  function useBonusItem(e) {
    if (e && e.cancelable) e.preventDefault();
    unlockMobileAudio();
    if (!hasJoinedRoom || !currentRoomCode || !currentItem) return;

    socket.emit('player:use_item', {
      roomCode: currentRoomCode,
      playerToken
    });

    triggerHaptic([45, 30, 75], 'boost');
    currentItem = null;
    updateItemButton(null);
  }

  btnItem.addEventListener('touchstart', useBonusItem, { passive: false });
  btnItem.addEventListener('click', useBonusItem);

  function triggerHorn(e) {
    if (e && e.cancelable) e.preventDefault();
    unlockMobileAudio();
    if (!hasJoinedRoom || !currentRoomCode) return;

    hornBtn.classList.add('active');
    setTimeout(() => hornBtn.classList.remove('active'), 180);

    socket.emit('player:honk', {
      roomCode: currentRoomCode,
      playerToken
    });

    triggerHaptic([25, 25], 'horn');
  }

  hornBtn.addEventListener('touchstart', triggerHorn, { passive: false });
  hornBtn.addEventListener('click', triggerHorn);

  function handleCreatorAction(e) {
    if (e && e.cancelable) e.preventDefault();
    unlockMobileAudio();
    if (!hasJoinedRoom || !currentRoomCode || !isCreator) return;

    if (roomStatus === 'lobby') {
      socket.emit('player:start_race', {
        roomCode: currentRoomCode,
        playerToken
      });
      triggerHaptic([40, 40], 'boost');
    } else if (roomStatus === 'finished') {
      socket.emit('player:restart_race', {
        roomCode: currentRoomCode,
        playerToken
      });
      triggerHaptic([40, 40], 'boost');
    }
  }

  creatorActionBtn.addEventListener('touchstart', handleCreatorAction, { passive: false });
  creatorActionBtn.addEventListener('click', handleCreatorAction);

  if (dismissPortraitBtn && portraitOverlay) {
    dismissPortraitBtn.addEventListener('click', () => {
      portraitOverlay.classList.add('dismissed');
    });
    dismissPortraitBtn.addEventListener('touchstart', (e) => {
      if (e.cancelable) e.preventDefault();
      portraitOverlay.classList.add('dismissed');
    }, { passive: false });
  }

  // --------------------------------------------------------------------------
  // 10. VERROUILLAGE DES GESTES PARASITES MOBILES (ZOOM, MENU CONTEXTUEL)
  // --------------------------------------------------------------------------
  window.addEventListener('contextmenu', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    e.preventDefault();
  });

  window.addEventListener('gesturestart', (e) => {
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('dblclick', (e) => {
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('blur', () => {
    resetControlsState();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      resetControlsState();
    }
  });

  // Initialisation au chargement
  initJoinForm();
})();
