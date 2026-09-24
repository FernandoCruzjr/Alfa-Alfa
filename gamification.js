(function (global) {
  'use strict';

  // ===================================================================
  // Matérias (subjects) e seus labels de exibição
  // ===================================================================
  var SUBJECTS = {
    PORTUGUES: { label: 'Português' },
    MATEMATICA: { label: 'Matemática' },
    GEOGRAFIA: { label: 'Geografia' },
    HISTORIA_NAVAL: { label: 'História Naval' },
    HISTORIA_NAVAL_FATOS_1: { label: 'História Naval' },
    OGSA: { label: 'OGSA' },
    LIDERANCA: { label: 'Liderança' },
    LIDERANCA_ATRIBUTOS: { label: 'Liderança' },
    ESTATUTO_RDM: { label: 'Estatuto e RDM' },
    JUSTICA_DISCIPLINA: { label: 'Justiça e Disciplina' },
    DOC_ADM_MB: { label: 'Doc. Administrativa' },
    CERIMONIAL: { label: 'Cerimonial' },
    'CAAML-703': { label: 'CAAML-703' },
    CAMAAL_CAV: { label: 'CAAML/CAv' },
    PEM2040: { label: 'PEM2040' },
    ROSAS_VIRTUDES: { label: 'Rosas e Virtudes' },
    PROVA_SIMULADA: { label: 'Prova Simulada' },
  };
  var TOTAL_SUBJECTS = Object.keys(SUBJECTS).length;

  function labelFor(quizId) {
    return (SUBJECTS[quizId] && SUBJECTS[quizId].label) || quizId;
  }

  // ===================================================================
  // Data da prova — ALTERE a linha abaixo pra data oficial assim que for
  // divulgada pela Marinha (formato 'AAAA-MM-DD'). Deixe como null pra
  // esconder a contagem regressiva em todas as páginas até lá.
  // ===================================================================
  var DATA_PROVA = '2026-10-18';

  function diasParaProva() {
    if (!DATA_PROVA) return null;
    var partes = DATA_PROVA.split('-').map(Number);
    var alvo = new Date(partes[0], partes[1] - 1, partes[2]);
    alvo.setHours(0, 0, 0, 0);
    var hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    var dias = Math.round((alvo - hoje) / (24 * 60 * 60 * 1000));
    return { dias: dias, data: DATA_PROVA };
  }

  // ===================================================================
  // Patentes navais — progressão por total de acertos acumulados
  // ===================================================================
  var PATENTES = [
    { min: 0, nome: 'Recruta', icon: 'fa-user' },
    { min: 50, nome: 'Marinheiro', icon: 'fa-anchor' },
    { min: 150, nome: 'Cabo', icon: 'fa-shield-halved' },
    { min: 300, nome: 'Terceiro-Sargento', icon: 'fa-star' },
    { min: 500, nome: 'Segundo-Sargento', icon: 'fa-star-half-stroke' },
    { min: 750, nome: 'Primeiro-Sargento', icon: 'fa-medal' },
    { min: 1000, nome: 'Suboficial', icon: 'fa-award' },
    { min: 1400, nome: 'Guarda-Marinha', icon: 'fa-compass' },
    { min: 1800, nome: 'Segundo-Tenente', icon: 'fa-crosshairs' },
    { min: 2300, nome: 'Primeiro-Tenente', icon: 'fa-gem' },
    { min: 2800, nome: 'Capitão-Tenente', icon: 'fa-shield' },
    { min: 3400, nome: 'Capitão de Corveta', icon: 'fa-ship' },
    { min: 4000, nome: 'Capitão de Fragata', icon: 'fa-sailboat' },
    { min: 4700, nome: 'Capitão de Mar e Guerra', icon: 'fa-anchor-circle-check' },
    { min: 5500, nome: 'Contra-Almirante', icon: 'fa-crown' },
    { min: 6500, nome: 'Vice-Almirante', icon: 'fa-crown' },
    { min: 8000, nome: 'Almirante de Esquadra', icon: 'fa-crown' },
  ];

  function patenteFor(totalAcertos) {
    var atual = PATENTES[0];
    for (var i = 0; i < PATENTES.length; i++) {
      if (totalAcertos >= PATENTES[i].min) atual = PATENTES[i];
    }
    return atual;
  }

  function initialFor(nomeOuEmail) {
    var s = (nomeOuEmail || '?').trim();
    return s ? s[0].toUpperCase() : '?';
  }

  // ===================================================================
  // Cache local de acesso (aprovado / quizzes liberados) — permite que a
  // página funcione offline usando o último resultado bem-sucedido, em vez
  // de travar numa tela de "sem conexão" toda vez que a internet cair.
  // ===================================================================
  var ACCESS_CACHE_PREFIX = 'alfa_access_cache_';

  function getAccessCache(userId) {
    try {
      var raw = localStorage.getItem(ACCESS_CACHE_PREFIX + userId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function setAccessCacheAprovado(userId, aprovado) {
    try {
      var cur = getAccessCache(userId) || { aprovado: false, quizIds: [] };
      cur.aprovado = aprovado;
      localStorage.setItem(ACCESS_CACHE_PREFIX + userId, JSON.stringify(cur));
    } catch (e) {}
  }

  function setAccessCacheQuiz(userId, aprovado, quizId, hasAccess) {
    try {
      var cur = getAccessCache(userId) || { aprovado: aprovado, quizIds: [] };
      cur.aprovado = aprovado;
      var set = {};
      (cur.quizIds || []).forEach(function (q) { set[q] = true; });
      if (hasAccess) set[quizId] = true; else delete set[quizId];
      cur.quizIds = Object.keys(set);
      localStorage.setItem(ACCESS_CACHE_PREFIX + userId, JSON.stringify(cur));
    } catch (e) {}
  }

  function showOfflineGate() {
    // Só usada como último recurso quando não há cache nenhum ainda.
    var el = document.getElementById('gate-checking');
    if (el) {
      el.innerHTML = '<div class="text-center"><i class="fa-solid fa-wifi text-3xl text-slate-500 mb-3"></i>' +
        '<p class="text-slate-300 text-sm">Sem conexão no momento.<br>Tenta de novo em alguns segundos.</p></div>';
    }
  }

  async function fetchAprovado(sb, userId) {
    try {
      var res = await sb.from('profiles').select('aprovado').eq('id', userId).maybeSingle();
      if (res.error) throw res.error;
      var aprovado = res.data ? !!res.data.aprovado : false;
      setAccessCacheAprovado(userId, aprovado);
      return aprovado;
    } catch (e) {
      var cached = getAccessCache(userId);
      if (cached) return cached.aprovado;
      showOfflineGate();
      throw e;
    }
  }

  async function fetchQuizAccess(sb, userId, quizId) {
    try {
      var res = await sb.from('acessos').select('quiz_id').eq('user_id', userId).eq('quiz_id', quizId).maybeSingle();
      if (res.error) throw res.error;
      var hasAccess = !!res.data;
      var cached = getAccessCache(userId);
      setAccessCacheQuiz(userId, cached ? cached.aprovado : true, quizId, hasAccess);
      return hasAccess;
    } catch (e) {
      var cached2 = getAccessCache(userId);
      if (cached2) return (cached2.quizIds || []).indexOf(quizId) !== -1;
      showOfflineGate();
      throw e;
    }
  }

  async function fetchAllAccess(sb, userId) {
    try {
      var res = await sb.from('acessos').select('quiz_id').eq('user_id', userId);
      if (res.error) throw res.error;
      var ids = (res.data || []).map(function (r) { return r.quiz_id; });
      var cached = getAccessCache(userId);
      var cur = { aprovado: cached ? cached.aprovado : true, quizIds: ids };
      try { localStorage.setItem(ACCESS_CACHE_PREFIX + userId, JSON.stringify(cur)); } catch (e2) {}
      return ids;
    } catch (e) {
      var cached2 = getAccessCache(userId);
      if (cached2) return cached2.quizIds || [];
      return [];
    }
  }

  // ===================================================================
  // Estatísticas pessoais e sequência (streak) de estudo
  // ===================================================================
  function computeStreak(resultados) {
    if (!resultados || !resultados.length) return { atual: 0 };
    var dias = {};
    resultados.forEach(function (r) {
      var d = new Date(r.criado_em || r.data || r.created_at);
      var key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      dias[key] = true;
    });
    var atual = 0;
    var cursor = new Date();
    while (true) {
      var key = cursor.getFullYear() + '-' + (cursor.getMonth() + 1) + '-' + cursor.getDate();
      if (dias[key]) {
        atual++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }
    return { atual: atual };
  }

  function personalStats(resultados) {
    var totalSimulados = (resultados || []).length;
    var totalAcertos = 0, totalQuestoes = 0;
    var materias = {};
    (resultados || []).forEach(function (r) {
      totalAcertos += (r.acertos || 0);
      totalQuestoes += (r.total || 0);
      if (r.quiz_id) materias[r.quiz_id] = true;
    });
    var percentualMedio = totalQuestoes > 0 ? Math.round((totalAcertos / totalQuestoes) * 100) : 0;
    return {
      totalSimulados: totalSimulados,
      totalAcertos: totalAcertos,
      percentualMedio: percentualMedio,
      materiasDistintas: Object.keys(materias).length,
    };
  }

  global.AlfaGamification = {
    SUBJECTS: SUBJECTS,
    TOTAL_SUBJECTS: TOTAL_SUBJECTS,
    labelFor: labelFor,
    diasParaProva: diasParaProva,
    PATENTES: PATENTES,
    patenteFor: patenteFor,
    initialFor: initialFor,
    fetchAprovado: fetchAprovado,
    fetchQuizAccess: fetchQuizAccess,
    fetchAllAccess: fetchAllAccess,
    computeStreak: computeStreak,
    personalStats: personalStats
  };
})(window);
