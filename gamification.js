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
      #sr-video-panel { position: fixed; left: 18px; bottom: 84px; z-index: 95; width: 320px; max-width: 92vw;
        background: #0b1b30; border: 1px solid #284b6d; border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.5);
        overflow: hidden; display: none; flex-direction: column; }
      #sr-video-panel.open { display: flex; }
      .sr-video-header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #050f1f;
        border-bottom: 1px solid #1c3352; }
      .sr-video-header span { flex: 1; font-size: 12px; font-weight: 700; color: #e2e8f0; }
      .sr-video-header button { background: transparent; border: none; color: #93a5c2; cursor: pointer; font-size: 13px; padding: 4px 6px; }
      .sr-video-header button:hover { color: #fff; }
      .sr-video-frame-wrap { width: 100%; height: 240px; background: #000; }
      .sr-video-frame-wrap iframe { width: 100%; height: 100%; border: 0; display: block; }
      @media (max-width: 640px) {
        #sr-fab span.sr-fab-text { display: none; }
        #sr-fab { padding: 12px; }
        #sr-video-panel { left: 8px; right: 8px; width: auto; bottom: 78px; }
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
        <div class="sr-video-header">
          <i class="fa-solid fa-video" style="color:#93a5c2"></i>
          <span>Áudio/vídeo da sala</span>
          <button type="button" id="sr-video-minimize" title="Minimizar (a chamada continua)"><i class="fa-solid fa-minus"></i></button>
          <button type="button" id="sr-video-hangup" title="Encerrar chamada"><i class="fa-solid fa-phone-slash"></i></button>
        </div>
        <div class="sr-video-frame-wrap"
