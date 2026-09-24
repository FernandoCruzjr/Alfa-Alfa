/*
 * study-room.js — "Sala de estudo em grupo" (modo sincronizado, estilo Kahoot)
 * ============================================================================
 * Módulo genérico, plugável em qualquer página de quiz do site (janela global
 * `StudyRoom`). Ele injeta sozinho o botão flutuante, o modal de criar/entrar
 * na sala e o banner de participantes — a página só precisa chamar
 * `StudyRoom.init({...})` passando o cliente Supabase já criado e um punhado
 * de "hooks" pra ler/escrever o estado do quiz (questão atual, lista de
 * questões sorteadas etc).
 *
 * Como plugar numa página de quiz:
 *   <script src="study-room.js"></script>
 *   <script>
 *     StudyRoom.init({
 *       sb, quizId: 'PROVA_SIMULADA',
 *       getUser: () => currentUser,
 *       getDraw: () => questionsData,
 *       setDraw: (arr) => { questionsData = arr; },
 *       getCurrentIndex: () => currentIndex,
 *       setCurrentIndex: (i) => { currentIndex = i; },
 *       getTotalQuestions: () => questionsData.length,
 *       isCorrectOption: (qIndex, optIndex) => questionsData[qIndex].correct === optIndex,
 *       onQuestionChanged: (i) => { renderQuestion(); renderGrid(); },
 *     });
 *   </script>
 * E, na função que o usuário usa pra responder (ex: selectOption), acrescentar:
 *     StudyRoom.reportAnswer(currentIndex, optIndex);
 *
 * Nada disso interfere no uso normal (sozinho) do quiz — a sala é 100% opcional.
 * ============================================================================
 */
(function () {
  'use strict';

  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O e 1/I, pra evitar confusão ao digitar

  let sb = null;
  let hooks = null;
  let quizId = null;

  const state = {
    roomId: null,
    codigo: null,
    isHost: false,
    status: 'idle', // idle | lobby | em_andamento | finalizada
    participants: [], // [{id, nome, avatar_url}]
    answeredCurrent: new Set(), // user_ids que já responderam a questão atual
    totalQuestions: 0,
  };

  let channel = null;
  let els = {}; // referências de DOM injetadas

  function storageKey() {
    return 'study_room_active::' + quizId;
  }
  function persistToStorage() {
    try { localStorage.setItem(storageKey(), JSON.stringify({ codigo: state.codigo })); } catch (e) {}
  }
  function clearStorage() {
    try { localStorage.removeItem(storageKey()); } catch (e) {}
  }

  function randomCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return s;
  }

  // ================= UI: injeta estilos e markup =================
  function injectStyles() {
    const css = `
      #sr-fab { position: fixed; left: 18px; bottom: 18px; z-index: 55; display: flex; align-items: center; gap: 8px;
        background: linear-gradient(135deg, #1E56A0, #123a73); color: #fff; border: 1px solid rgba(255,255,255,.18);
        padding: 11px 16px; border-radius: 999px; box-shadow: 0 12px 30px rgba(0,0,0,.4); font: 600 13px 'Inter', ui-sans-serif, sans-serif;
        cursor: pointer; transition: transform .15s ease; }
      #sr-fab:hover { transform: translateY(-2px); }
      #sr-fab .sr-fab-badge { background: #fbbf24; color: #1a1a1a; font-size: 10px; font-weight: 800; border-radius: 999px; padding: 1px 7px; }
      #sr-overlay { position: fixed; inset: 0; z-index: 90; background: rgba(3,9,20,.72); backdrop-filter: blur(2px);
        display: none; align-items: center; justify-content: center; padding: 18px; }
      #sr-overlay.open { display: flex; }
      #sr-modal { width: 100%; max-width: 420px; background: #0b1b30; border: 1px solid #284b6d; border-radius: 18px;
        box-shadow: 0 30px 80px rgba(0,0,0,.5); padding: 22px; font-family: 'Inter', ui-sans-serif, sans-serif; color: #e2e8f0; max-height: 88vh; overflow-y: auto; }
      #sr-modal h3 { font-family: 'Fraunces', ui-serif, Georgia, serif; font-size: 19px; font-weight: 700; color: #fff; margin-bottom: 4px; }
      #sr-modal p.sr-sub { font-size: 12.5px; color: #93a5c2; margin-bottom: 16px; }
      .sr-tabs { display: flex; gap: 6px; margin-bottom: 16px; background: #050f1f; border-radius: 10px; padding: 4px; }
      .sr-tab { flex: 1; text-align: center; padding: 8px 0; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: #93a5c2; cursor: pointer; }
      .sr-tab.active { background: #1E56A0; color: #fff; }
      .sr-field { width: 100%; background: #050f1f; border: 1px solid #284b6d; border-radius: 10px; padding: 11px 13px;
        color: #fff; font-size: 15px; letter-spacing: .12em; text-transform: uppercase; text-align: center; font-weight: 700; }
      .sr-field:focus { outline: none; border-color: #2384d6; }
      .sr-btn { width: 100%; padding: 11px; border-radius: 10px; font-weight: 700; font-size: 13.5px; cursor: pointer; border: none;
        transition: filter .15s ease; margin-top: 10px; }
      .sr-btn:hover { filter: brightness(1.1); }
      .sr-btn.primary { background: #2869b7; color: #fff; }
      .sr-btn.ghost { background: transparent; color: #93a5c2; border: 1px solid #284b6d; }
      .sr-btn:disabled { opacity: .45; cursor: not-allowed; }
      .sr-code-display { text-align: center; margin: 6px 0 18px; }
      .sr-code-display .sr-code { font-family: 'Fraunces', ui-serif, serif; font-size: 40px; font-weight: 700; letter-spacing: .18em; color: #fbbf24; }
      .sr-code-display .sr-code-hint { font-size: 11px; color: #93a5c2; margin-top: 2px; }
      .sr-participants { display: flex; flex-direction: column; gap: 7px; margin: 4px 0 8px; max-height: 220px; overflow-y: auto; }
      .sr-participant { display: flex; align-items: center; gap: 9px; background: #050f1f; border: 1px solid #1c3352; border-radius: 10px; padding: 7px 10px; font-size: 13px; }
      .sr-participant .sr-avatar { width: 26px; height: 26px; border-radius: 999px; background: #1E56A0; color: #fff; font-size: 11px;
        font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; object-fit: cover; }
      .sr-participant .sr-name { flex: 1; color: #e2e8f0; }
      .sr-participant .sr-tag-host { font-size: 9.5px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: .05em; }
      .sr-participant .sr-check { color: #34d399; font-size: 13px; display: none; }
      .sr-participant.answered .sr-check { display: inline-block; }
      #sr-error { font-size: 12px; color: #fca5a5; margin-top: 8px; min-height: 14px; }
      #sr-banner { position: sticky; top: 0; z-index: 45; background: #0b1b30f2; border-bottom: 1px solid #284b6d;
        backdrop-filter: blur(6px); display: none; }
      #sr-banner.open { display: block; }
      .sr-banner-inner { max-width: 72rem; margin: 0 auto; padding: 8px 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      .sr-banner-label { font-size: 11px; font-weight: 700; color: #fbbf24; letter-spacing: .04em; display: flex; align-items: center; gap: 6px; white-space: nowrap; }
      .sr-banner-avatars { display: flex; gap: -4px; align-items: center; flex: 1; min-width: 0; overflow-x: auto; }
      .sr-banner-avatars .sr-avatar { width: 24px; height: 24px; border-radius: 999px; background: #1E56A0; color: #fff; font-size: 10px;
        font-weight: 700; display: flex; align-items: center; justify-content: center; border: 2px solid #0b1b30; margin-left: -6px; flex-shrink: 0; object-fit: cover; }
      .sr-banner-avatars .sr-avatar.answered { box-shadow: 0 0 0 2px #34d399; }
      .sr-banner-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
      .sr-mini-btn { font-size: 11.5px; font-weight: 700; padding: 6px 11px; border-radius: 8px; cursor: pointer; border: none; white-space: nowrap; }
      .sr-mini-btn.primary { background: #2869b7; color: #fff; }
      .sr-mini-btn.danger { background: transparent; color: #f87171; border: 1px solid #7f1d1d; }
      .sr-mini-btn.ghost-mini { background: transparent; color: #93a5c2; border: 1px solid #284b6d; padding: 6px 9px; }
      .sr-mini-btn.ghost-mini:hover { color: #fff; border-color: #2384d6; }
      #sr-results-list { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 4px; max-height: 260px; overflow-y: auto; }
      .sr-result-row { display: flex; align-items: center; gap: 10px; background: #050f1f; border: 1px solid #1c3352; border-radius: 10px; padding: 8px 11px; font-size: 13px; }
      .sr-result-row .sr-pos { width: 20px; text-align: center; font-weight: 800; color: #fbbf24; font-size: 12px; }
      .sr-result-row .sr-name { flex: 1; }
      .sr-result-row .sr-score { font-weight: 700; color: #34d399; font-size: 12.5px; }
      .sr-video-btn { display: inline-flex; align-items: center; gap: 6px; }
      #sr-video-panel { position: fixed; left: 18px; bottom: 84px; z-index: 95; width: min(320px, 92vw);
        background: #0b1b30; border: 1px solid #284b6d; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.5);
        overflow: hidden; display: none; flex-direction: column; }
      #sr-video-panel.open { display: flex; }
      #sr-video-panel.sr-dragging { opacity: .92; box-shadow: 0 24px 70px rgba(0,0,0,.65); transition: none; }
      .sr-video-header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #050f1f;
        border-bottom: 1px solid #1c3352; cursor: move; touch-action: none; user-select: none; }
      .sr-video-header .sr-drag-handle { color: #4b6280; font-size: 12px; }
      .sr-video-header span { flex: 1; font-size: 12px; font-weight: 700; color: #e2e8f0; }
      .sr-video-header button { background: transparent; border: none; color: #93a5c2; cursor: pointer; font-size: 13px; padding: 4px 6px; }
      .sr-video-header button:hover { color: #fff; }
      .sr-video-frame-wrap { width: 100%; height: 240px; background: #000; }
      .sr-video-frame-wrap iframe { width: 100%; height: 100%; border: 0; display: block; }
      @media (max-width: 640px) {
        #sr-fab span.sr-fab-text { display: none; }
        #sr-fab { padding: 12px; }
      }
    `;
    const styleEl = document.createElement('style');
    styleEl.id = 'sr-styles';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function buildUI() {
    els.fab = el(`
      <button id="sr-fab" type="button" aria-label="Sala de estudo em grupo">
        <i class="fa-solid fa-people-group"></i> <span class="sr-fab-text">Sala de estudo</span>
      </button>
    `);
    document.body.appendChild(els.fab);

    els.overlay = el(`
      <div id="sr-overlay">
        <div id="sr-modal"></div>
      </div>
    `);
    document.body.appendChild(els.overlay);
    els.modal = els.overlay.querySelector('#sr-modal');

    els.banner = el(`
      <div id="sr-banner">
        <div class="sr-banner-inner">
          <div class="sr-banner-label"><i class="fa-solid fa-people-group"></i> <span id="sr-banner-code"></span></div>
          <div class="sr-banner-avatars" id="sr-banner-avatars"></div>
          <div class="sr-banner-actions" id="sr-banner-actions"></div>
        </div>
      </div>
    `);
    const header = document.querySelector('header');
    if (header && header.parentNode) header.parentNode.insertBefore(els.banner, header.nextSibling);
    else document.body.insertBefore(els.banner, document.body.firstChild);

    els.videoPanel = el(`
      <div id="sr-video-panel">
        <div class="sr-video-header" id="sr-video-header">
          <i class="fa-solid fa-grip-vertical sr-drag-handle"></i>
          <i class="fa-solid fa-video" style="color:#93a5c2"></i>
          <span>Áudio/vídeo da sala</span>
          <button type="button" id="sr-video-minimize" title="Minimizar (a chamada continua)"><i class="fa-solid fa-minus"></i></button>
          <button type="button" id="sr-video-hangup" title="Encerrar chamada"><i class="fa-solid fa-phone-slash"></i></button>
        </div>
        <div class="sr-video-frame-wrap" id="sr-video-frame-wrap"></div>
      </div>
    `);
    document.body.appendChild(els.videoPanel);
    els.videoPanel.querySelector('#sr-video-minimize').addEventListener('click', closeVideoPanel);
    els.videoPanel.querySelector('#sr-video-hangup').addEventListener('click', hangUpVideoCall);
    makeVideoPanelDraggable();

    els.fab.addEventListener('click', () => {
      if (state.status === 'idle') openLobbyChooser();
      else openRoomPanel();
    });
    els.overlay.addEventListener('click', (e) => { if (e.target === els.overlay) closeOverlay(); });
  }

  // ================= Chamada de áudio/vídeo (Jitsi Meet embutido) =================
  function jitsiRoomName() {
    // Nome de sala derivado do UUID da sala (não do código de 5 letras) — assim
    // ninguém entra na videochamada só adivinhando o código curto.
    return 'AlfaAlfaSalaEstudo' + String(state.roomId || '').replace(/[^a-zA-Z0-9]/g, '');
  }

  function currentDisplayName() {
    const user = hooks.getUser && hooks.getUser();
    if (!user) return 'Aluno';
    const me = state.participants.find(p => p.id === user.id);
    return (me && me.nome) || (user.email ? user.email.split('@')[0] : 'Aluno');
  }

  function openVideoCall() {
    if (!state.roomId) return;
    const wrap = els.videoPanel.querySelector('#sr-video-frame-wrap');
    if (!wrap.querySelector('iframe')) {
      const room = jitsiRoomName();
      const displayName = encodeURIComponent(currentDisplayName());
      const src = 'https://meet.jit.si/' + room +
        '#config.prejoinPageEnabled=false' +
        '&config.startWithAudioMuted=true' +
        '&config.startWithVideoMuted=true' +
        '&config.disableDeepLinking=true' +
        '&userInfo.displayName=%22' + displayName + '%22';
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.allow = 'camera; microphone; fullscreen; display-capture; autoplay; clipboard-write';
      wrap.appendChild(iframe);
    }
    els.videoPanel.classList.add('open');
  }

  function closeVideoPanel() {
    // Só esconde — a chamada continua rolando (iframe não é removido).
    els.videoPanel.classList.remove('open');
  }

  function hangUpVideoCall() {
    const wrap = els.videoPanel.querySelector('#sr-video-frame-wrap');
    wrap.innerHTML = '';
    els.videoPanel.classList.remove('open');
  }

  function toggleVideoPanel() {
    if (els.videoPanel.classList.contains('open')) closeVideoPanel();
    else openVideoCall();
  }

  // Arrastar a caixa de vídeo pra qualquer lugar da tela (mouse ou toque),
  // segurando pela barra de título. A posição escolhida fica valendo
  // enquanto a página estiver aberta (mesmo minimizando e reabrindo).
  function makeVideoPanelDraggable() {
    const panel = els.videoPanel;
    const header = panel.querySelector('#sr-video-header');
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    function clamp(val, min, max) { return Math.min(Math.max(val, min), max); }

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return; // não arrasta ao clicar em minimizar/encerrar
      dragging = true;
      panel.classList.add('sr-dragging');
      try { header.setPointerCapture(e.pointerId); } catch (err) {}
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      // Trava a posição atual em left/top absolutos e solta o bottom do CSS,
      // assim o arrasto passa a controlar a posição livremente.
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
    });

    header.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxLeft = Math.max(4, window.innerWidth - panel.offsetWidth - 4);
      const maxTop = Math.max(4, window.innerHeight - panel.offsetHeight - 4);
      panel.style.left = clamp(startLeft + dx, 4, maxLeft) + 'px';
      panel.style.top = clamp(startTop + dy, 4, maxTop) + 'px';
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('sr-dragging');
      try { header.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
  }

  function closeOverlay() { els.overlay.classList.remove('open'); }
  function openOverlay() { els.overlay.classList.add('open'); }

  // ================= Telas do modal =================
  function openLobbyChooser() {
    els.modal.innerHTML = `
      <h3>Sala de estudo</h3>
      <p class="sr-sub">Convide um amigo (ou um grupinho) pra responder as mesmas questões juntos, ao vivo.</p>
      <div class="sr-tabs">
        <div class="sr-tab active" data-tab="criar">Criar sala</div>
        <div class="sr-tab" data-tab="entrar">Entrar com código</div>
      </div>
      <div id="sr-tab-body"></div>
      <div id="sr-error"></div>
      <button class="sr-btn ghost" id="sr-cancel">Cancelar</button>
    `;
    renderTabBody('criar');
    els.modal.querySelectorAll('.sr-tab').forEach(tabEl => {
      tabEl.addEventListener('click', () => {
        els.modal.querySelectorAll('.sr-tab').forEach(t => t.classList.remove('active'));
        tabEl.classList.add('active');
        renderTabBody(tabEl.dataset.tab);
      });
    });
    els.modal.querySelector('#sr-cancel').addEventListener('click', closeOverlay);
    openOverlay();
  }

  function renderTabBody(tab) {
    const body = els.modal.querySelector('#sr-tab-body');
    if (tab === 'criar') {
      body.innerHTML = `
        <p class="sr-sub" style="margin-bottom:10px">Você vira o anfitrião: escolhe quando começar e controla o ritmo das questões.</p>
        <button class="sr-btn primary" id="sr-create-btn"><i class="fa-solid fa-plus"></i> Criar sala nova</button>
      `;
      body.querySelector('#sr-create-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Criando...';
        const ok = await createRoom();
        btn.disabled = false;
        if (ok) openRoomPanel();
      });
    } else {
      body.innerHTML = `
        <input class="sr-field" id="sr-code-input" maxlength="5" placeholder="CÓDIGO" autocomplete="off">
        <button class="sr-btn primary" id="sr-join-btn"><i class="fa-solid fa-right-to-bracket"></i> Entrar na sala</button>
      `;
      const input = body.querySelector('#sr-code-input');
      input.addEventListener('input', () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.querySelector('#sr-join-btn').click(); });
      body.querySelector('#sr-join-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Entrando...';
        const ok = await joinRoom(input.value);
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Entrar na sala';
        if (ok) openRoomPanel();
      });
      setTimeout(() => input.focus(), 50);
    }
  }

  function showError(msg) {
    const errEl = els.modal.querySelector('#sr-error');
    if (errEl) errEl.textContent = msg;
  }

  function openRoomPanel() {
    if (state.status === 'lobby') renderLobbyPanel();
    else if (state.status === 'em_andamento') { closeOverlay(); }
    else if (state.status === 'finalizada') renderResultsPanel();
    else openLobbyChooser();
  }

  function renderLobbyPanel() {
    els.modal.innerHTML = `
      <h3>Sala de estudo</h3>
      <p class="sr-sub">${state.isHost ? 'Compartilhe o código com quem vai estudar com você.' : 'Aguardando o anfitrião começar...'}</p>
      <div class="sr-code-display">
        <div class="sr-code">${state.codigo || ''}</div>
        <div class="sr-code-hint">código da sala</div>
      </div>
      <div class="sr-participants" id="sr-participants-list"></div>
      <div id="sr-error"></div>
      <button class="sr-btn ghost sr-video-btn" id="sr-video-btn"><i class="fa-solid fa-video"></i> Ativar áudio/vídeo</button>
      ${state.isHost ? '<button class="sr-btn primary" id="sr-start-btn"><i class="fa-solid fa-play"></i> Começar pra todo mundo</button>' : ''}
      <button class="sr-btn ghost" id="sr-leave-btn">Sair da sala</button>
    `;
    renderParticipantsInto(els.modal.querySelector('#sr-participants-list'));
    if (state.isHost) {
      els.modal.querySelector('#sr-start-btn').addEventListener('click', startRoom);
    }
    els.modal.querySelector('#sr-video-btn').addEventListener('click', openVideoCall);
    els.modal.querySelector('#sr-leave-btn').addEventListener('click', leaveRoom);
    openOverlay();
  }

  function renderResultsPanel() {
    els.modal.innerHTML = `
      <h3><i class="fa-solid fa-flag-checkered" style="color:#fbbf24"></i> Sala encerrada</h3>
      <p class="sr-sub">Placar de acertos desta sessão:</p>
      <div id="sr-results-list"><p class="sr-sub">Carregando...</p></div>
      <button class="sr-btn primary" id="sr-close-results-btn">Fechar</button>
    `;
    els.modal.querySelector('#sr-close-results-btn').addEventListener('click', () => { closeOverlay(); resetToIdle(); });
    loadAndRenderResults();
    openOverlay();
  }

  async function loadAndRenderResults() {
    const listEl = els.modal.querySelector('#sr-results-list');
    if (!listEl) return;
    try {
      const { data: respostas } = await sb.from('salas_estudo_respostas').select('user_id, is_correct').eq('sala_id', state.roomId);
      const scoreByUser = {};
      (respostas || []).forEach(r => {
        scoreByUser[r.user_id] = scoreByUser[r.user_id] || 0;
        if (r.is_correct) scoreByUser[r.user_id]++;
      });
      const rows = state.participants.map(p => ({ ...p, score: scoreByUser[p.id] || 0 }))
        .sort((a, b) => b.score - a.score);
      if (!listEl) return;
      listEl.innerHTML = rows.map((p, idx) => `
        <div class="sr-result-row">
          <div class="sr-pos">${idx + 1}º</div>
          ${avatarHtml(p)}
          <div class="sr-name">${escapeHtml(p.nome || 'Aluno')}</div>
          <div class="sr-score">${p.score} acerto${p.score === 1 ? '' : 's'}</div>
        </div>
      `).join('') || '<p class="sr-sub">Ninguém respondeu nenhuma questão.</p>';
    } catch (e) {
      if (listEl) listEl.innerHTML = '<p class="sr-sub">Não deu pra carregar o placar agora.</p>';
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function initialFor(name) {
    const s = (name || '?').trim();
    return s ? s[0].toUpperCase() : '?';
  }
  function avatarHtml(p) {
    if (p.avatar_url) return `<img class="sr-avatar" src="${p.avatar_url}" alt="">`;
    return `<span class="sr-avatar">${initialFor(p.nome)}</span>`;
  }

  function renderParticipantsInto(container) {
    if (!container) return;
    container.innerHTML = state.participants.map(p => `
      <div class="sr-participant ${state.answeredCurrent.has(p.id) ? 'answered' : ''}">
        ${avatarHtml(p)}
        <span class="sr-name">${escapeHtml(p.nome || 'Aluno')}</span>
        ${p.id === state.hostId ? '<span class="sr-tag-host">Anfitrião</span>' : ''}
        <i class="fa-solid fa-circle-check sr-check"></i>
      </div>
    `).join('') || '<p class="sr-sub">Só você por enquanto.</p>';
  }

  function renderBanner() {
    if (state.status !== 'em_andamento') { els.banner.classList.remove('open'); return; }
    els.banner.classList.add('open');
    els.banner.querySelector('#sr-banner-code').textContent = 'Sala ' + state.codigo;
    const avatarsEl = els.banner.querySelector('#sr-banner-avatars');
    avatarsEl.innerHTML = state.participants.map(p => {
      const answered = state.answeredCurrent.has(p.id);
      const tag = p.avatar_url
        ? `<img class="sr-avatar ${answered ? 'answered' : ''}" src="${p.avatar_url}" title="${escapeHtml(p.nome || '')}" alt="">`
        : `<span class="sr-avatar ${answered ? 'answered' : ''}" title="${escapeHtml(p.nome || '')}">${initialFor(p.nome)}</span>`;
      return tag;
    }).join('');
    const actionsEl = els.banner.querySelector('#sr-banner-actions');
    const videoBtnHtml = '<button class="sr-mini-btn ghost-mini" id="sr-banner-video" title="Áudio/vídeo"><i class="fa-solid fa-video"></i></button>';
    if (state.isHost) {
      const isLast = hooks.getTotalQuestions && (hooks.getCurrentIndex() >= hooks.getTotalQuestions() - 1);
      actionsEl.innerHTML = `
        ${videoBtnHtml}
        ${isLast ? '<button class="sr-mini-btn primary" id="sr-banner-finish">Finalizar sala</button>'
                  : '<button class="sr-mini-btn primary" id="sr-banner-next">Próxima <i class="fa-solid fa-arrow-right"></i></button>'}
        <button class="sr-mini-btn danger" id="sr-banner-leave">Sair</button>
      `;
      const nextBtn = actionsEl.querySelector('#sr-banner-next');
      if (nextBtn) nextBtn.addEventListener('click', hostNext);
      const finishBtn = actionsEl.querySelector('#sr-banner-finish');
      if (finishBtn) finishBtn.addEventListener('click', hostFinish);
      actionsEl.querySelector('#sr-banner-leave').addEventListener('click', leaveRoom);
    } else {
      actionsEl.innerHTML = `${videoBtnHtml}<button class="sr-mini-btn danger" id="sr-banner-leave">Sair</button>`;
      actionsEl.querySelector('#sr-banner-leave').addEventListener('click', leaveRoom);
    }
    actionsEl.querySelector('#sr-banner-video').addEventListener('click', toggleVideoPanel);
  }

  // ================= Ações =================
  async function createRoom() {
    const user = hooks.getUser && hooks.getUser();
    if (!user) { showError('Você precisa estar logado.'); return false; }
    let codigo = randomCode();
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: existing } = await sb.from('salas_estudo').select('id').eq('codigo', codigo).maybeSingle();
        if (!existing) break;
        codigo = randomCode();
      }
      const draw = hooks.getDraw ? hooks.getDraw() : null;
      const { data, error } = await sb.from('salas_estudo').insert({
        codigo, quiz_id: quizId, host_id: user.id, draw_json: draw,
        current_index: hooks.getCurrentIndex ? hooks.getCurrentIndex() : 0, status: 'lobby'
      }).select().single();
      if (error || !data) { showError('Não deu pra criar a sala agora. Tenta de novo.'); return false; }
      await sb.from('salas_estudo_participantes').insert({ sala_id: data.id, user_id: user.id });
      state.roomId = data.id; state.codigo = data.codigo; state.isHost = true; state.status = 'lobby';
      state.hostId = user.id;
      persistToStorage();
      await loadParticipants();
      subscribeRealtime();
      return true;
    } catch (e) {
      showError('Não deu pra criar a sala agora. Tenta de novo.');
      return false;
    }
  }

  async function joinRoom(codigoInput) {
    const codigo = (codigoInput || '').trim().toUpperCase();
    if (codigo.length < 4) { showError('Digite o código da sala.'); return false; }
    const user = hooks.getUser && hooks.getUser();
    if (!user) { showError('Você precisa estar logado.'); return false; }
    try {
      const { data: sala, error } = await sb.from('salas_estudo').select('*').eq('codigo', codigo).maybeSingle();
      if (error || !sala) { showError('Não achei essa sala. Confere o código com quem te chamou.'); return false; }
      if (sala.status === 'finalizada') { showError('Essa sala já foi encerrada.'); return false; }
      await sb.from('salas_estudo_participantes').upsert(
        { sala_id: sala.id, user_id: user.id }, { onConflict: 'sala_id,user_id', ignoreDuplicates: true }
      );
      state.roomId = sala.id; state.codigo = sala.codigo; state.isHost = (sala.host_id === user.id);
      state.status = sala.status; state.hostId = sala.host_id;
      if (Array.isArray(sala.draw_json) && sala.draw_json.length && hooks.setDraw) hooks.setDraw(sala.draw_json);
      if (hooks.setCurrentIndex) hooks.setCurrentIndex(sala.current_index || 0);
      persistToStorage();
      await loadParticipants();
      await loadAnswersForIndex(sala.current_index || 0);
      subscribeRealtime();
      if (sala.status === 'em_andamento' && hooks.onQuestionChanged) hooks.onQuestionChanged(sala.current_index || 0);
      renderBanner();
      return true;
    } catch (e) {
      showError('Não deu pra entrar na sala agora. Tenta de novo.');
      return false;
    }
  }

  async function loadParticipants() {
    if (!state.roomId) return;
    const { data: rows } = await sb.from('salas_estudo_participantes').select('user_id').eq('sala_id', state.roomId);
    const ids = (rows || []).map(r => r.user_id);
    if (!ids.length) { state.participants = []; return; }
    const { data: profiles } = await sb.from('profiles').select('id, nome, avatar_url').in('id', ids);
    const byId = {};
    (profiles || []).forEach(p => { byId[p.id] = p; });
    state.participants = ids.map(id => ({ id, nome: (byId[id] && byId[id].nome) || 'Aluno', avatar_url: byId[id] && byId[id].avatar_url }));
    if (hooks.onParticipantsChanged) hooks.onParticipantsChanged(state.participants);
  }

  async function loadAnswersForIndex(index) {
    state.answeredCurrent = new Set();
    if (!state.roomId) return;
    const { data } = await sb.from('salas_estudo_respostas').select('user_id').eq('sala_id', state.roomId).eq('question_index', index);
    (data || []).forEach(r => state.answeredCurrent.add(r.user_id));
  }

  function subscribeRealtime() {
    if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; }
    channel = sb.channel('sala:' + state.roomId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'salas_estudo', filter: 'id=eq.' + state.roomId }, handleRoomUpdate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'salas_estudo_participantes', filter: 'sala_id=eq.' + state.roomId }, handleParticipantsEvent)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'salas_estudo_respostas', filter: 'sala_id=eq.' + state.roomId }, handleAnswerInsert)
      .subscribe();
  }

  function handleRoomUpdate(payload) {
    const row = payload.new;
    if (!row) return;
    const statusChangedToStart = state.status !== 'em_andamento' && row.status === 'em_andamento';
    const indexChanged = row.current_index !== (hooks.getCurrentIndex ? hooks.getCurrentIndex() : null);
    state.status = row.status;
    if (row.status === 'finalizada') {
      renderBanner();
      if (!els.overlay.classList.contains('open')) renderResultsPanel();
      return;
    }
    if (statusChangedToStart || indexChanged) {
      if (hooks.setCurrentIndex) hooks.setCurrentIndex(row.current_index || 0);
      loadAnswersForIndex(row.current_index || 0).then(() => { renderBanner(); refreshOpenPanels(); });
      if (hooks.onQuestionChanged) hooks.onQuestionChanged(row.current_index || 0);
      if (statusChangedToStart) closeOverlay();
    }
    renderBanner();
  }

  function handleParticipantsEvent() {
    loadParticipants().then(() => { renderBanner(); refreshOpenPanels(); });
  }

  function handleAnswerInsert(payload) {
    const row = payload.new;
    if (!row) return;
    const currentIdx = hooks.getCurrentIndex ? hooks.getCurrentIndex() : null;
    if (row.question_index === currentIdx) {
      state.answeredCurrent.add(row.user_id);
      renderBanner();
      refreshOpenPanels();
    }
  }

  function refreshOpenPanels() {
    if (!els.overlay.classList.contains('open')) return;
    const list = els.modal.querySelector('#sr-participants-list');
    if (list) renderParticipantsInto(list);
  }

  async function startRoom() {
    if (!state.isHost) return;
    await sb.from('salas_estudo').update({ status: 'em_andamento', current_index: 0, atualizado_em: new Date().toISOString() }).eq('id', state.roomId);
    state.status = 'em_andamento';
    if (hooks.setCurrentIndex) hooks.setCurrentIndex(0);
    loadAnswersForIndex(0).then(renderBanner);
    if (hooks.onQuestionChanged) hooks.onQuestionChanged(0);
    closeOverlay();
    renderBanner();
  }

  async function hostNext() {
    if (!state.isHost || !state.roomId) return;
    const total = hooks.getTotalQuestions ? hooks.getTotalQuestions() : Infinity;
    const cur = hooks.getCurrentIndex ? hooks.getCurrentIndex() : 0;
    const next = Math.min(cur + 1, total - 1);
    if (next === cur) return;
    await sb.from('salas_estudo').update({ current_index: next, atualizado_em: new Date().toISOString() }).eq('id', state.roomId);
    if (hooks.setCurrentIndex) hooks.setCurrentIndex(next);
    await loadAnswersForIndex(next);
    if (hooks.onQuestionChanged) hooks.onQuestionChanged(next);
    renderBanner();
  }

  async function hostFinish() {
    if (!state.isHost || !state.roomId) return;
    await sb.from('salas_estudo').update({ status: 'finalizada', atualizado_em: new Date().toISOString() }).eq('id', state.roomId);
    state.status = 'finalizada';
    renderBanner();
    renderResultsPanel();
  }

  async function leaveRoom() {
    const roomId = state.roomId;
    const user = hooks.getUser && hooks.getUser();
    closeOverlay();
    if (channel) { try { sb.removeChannel(channel); } catch (e) {} channel = null; }
    if (roomId && user) {
      try { await sb.from('salas_estudo_participantes').delete().eq('sala_id', roomId).eq('user_id', user.id); } catch (e) {}
    }
    resetToIdle();
  }

  function resetToIdle() {
    state.roomId = null; state.codigo = null; state.isHost = false; state.status = 'idle';
    state.participants = []; state.answeredCurrent = new Set();
    clearStorage();
    hangUpVideoCall();
    renderBanner();
  }

  async function tryResumeFromStorage() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey()) || 'null'); } catch (e) {}
    if (saved && saved.codigo) {
      await joinRoom(saved.codigo);
    }
  }

  // ================= API pública =================
  async function init(opts) {
    sb = opts.sb;
    quizId = opts.quizId;
    hooks = opts;
    if (!document.getElementById('sr-styles')) injectStyles();
    if (!document.getElementById('sr-fab')) buildUI();
    await tryResumeFromStorage();
  }

  function reportAnswer(questionIndex, optionIndex) {
    if (state.status !== 'em_andamento' || !state.roomId) return;
    const user = hooks.getUser && hooks.getUser();
    if (!user) return;
    const isCorrect = !!(hooks.isCorrectOption && hooks.isCorrectOption(questionIndex, optionIndex));
    sb.from('salas_estudo_respostas').upsert({
      sala_id: state.roomId, user_id: user.id, question_index: questionIndex,
      option_index: optionIndex, is_correct: isCorrect
    }, { onConflict: 'sala_id,user_id,question_index' }).then(() => {
      state.answeredCurrent.add(user.id);
      renderBanner();
      refreshOpenPanels();
    });
  }

  window.StudyRoom = {
    init,
    reportAnswer,
    isInRoom: () => state.status === 'em_andamento' || state.status === 'lobby',
    isActive: () => state.status === 'em_andamento',
    isHost: () => state.isHost,
    getCodigo: () => state.codigo,
  };
})();
