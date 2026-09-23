/*
 * gamification.js — Plataforma de Estudos CA-AA/AFN
 * -----------------------------------------------------------------------
 * Módulo compartilhado (não é um módulo ES, é um <script> normal que
 * define window.AlfaGamification) usado por ranking.html, jogo-memoria.html,
 * caderno.html e opcionalmente index.html.
 *
 * IMPORTANTE: este arquivo NÃO cria seu próprio cliente Supabase (pra não
 * duplicar o GoTrueClient dentro da mesma página, o que o supabase-js avisa
 * no console e pode causar dessincronia de sessão). Cada página continua
 * criando o seu `sb = supabase.createClient(...)` normalmente, busca os
 * dados (resultados, respostas_detalhadas etc.) com ele, e passa esses
 * dados prontos pras funções abaixo.
 */
(function (global) {
  'use strict';

  // ===================================================================
  // Catálogo de matérias — usado pra montar seletores, links e rótulos
  // de forma consistente entre as páginas novas. Mantido em sincronia
  // manualmente com o grid "Banco de Questões" do index.html.
  // ===================================================================
  var SUBJECTS = {
    PORTUGUES: { label: 'Língua Portuguesa', url: 'portugues.html', total: 372 },
    HISTORIA_NAVAL: { label: 'História Militar Naval', url: 'historia-naval.html', total: 583 },
    GEOGRAFIA: { label: 'Geografia', url: 'geografia.html', total: 164 },
    MATEMATICA: { label: 'Matemática', url: 'matematica.html', total: 79 },
    'CAAML-703': { label: 'Embarcações Miúdas & Segurança', url: 'caaml-703.html', total: 65 },
    CERIMONIAL: { label: 'Cerimonial da Marinha', url: 'cerimonial.html', total: 280 },
    ROSAS_VIRTUDES: { label: 'Rosas das Virtudes', url: 'rosas-virtudes.html', total: 30 },
    JUSTICA_DISCIPLINA: { label: 'Justiça e Disciplina', url: 'justica-disciplina.html', total: 147 },
    LIDERANCA: { label: 'Liderança', url: 'lideranca.html', total: 210 },
    OGSA: { label: 'OGSA', url: 'ogsa.html', total: 211 },
    CAMAAL_CAV: { label: 'CAMAAL 1202 (CAV)', url: 'camaal-cav.html', total: 122 },
    ESTATUTO_RDM: { label: 'Estatuto dos Militares & RDM', url: 'estatuto-rdm.html', total: 176 },
    DOC_ADM_MB: { label: 'Documentação Administrativa na MB', url: 'doc-adm-mb.html', total: 200 },
    PEM2040: { label: 'PEM-2040', url: 'pem2040.html', total: 55 },
    PROVA_SIMULADA: { label: 'Prova Simulada', url: 'prova-simulada.html', total: null }
  };

  var TOTAL_SUBJECTS = Object.keys(SUBJECTS).filter(function (k) { return k !== 'PROVA_SIMULADA'; }).length;

  function labelFor(quizId) {
    return (SUBJECTS[quizId] && SUBJECTS[quizId].label) || quizId;
  }

  // ===================================================================
  // Data da prova — ALTERE a linha abaixo pra data oficial assim que for
  // divulgada pela Marinha (formato 'AAAA-MM-DD'). Deixe como null pra
  // esconder a contagem regressiva em todas as páginas até lá.
  // ===================================================================
  var DATA_PROVA = '2027-10-18';

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
  // Patentes navais — título exibido conforme o total de questões
  // corretas acumuladas (mesmo critério usado pra ordenar o ranking
  // geral), do "Recruta" até "Almirante". Puramente cosmético/motivacional,
  // não interfere em nenhuma trava de acesso.
  // ===================================================================
  var PATENTES = [
    { min: 0, nome: 'Recruta', icon: 'fa-user' },
    { min: 50, nome: 'Marinheiro', icon: 'fa-anchor' },
    { min: 150, nome: 'Cabo', icon: 'fa-shield-halved' },
    { min: 300, nome: 'Terceiro-Sargento', icon: 'fa-star' },
    { min: 500, nome: 'Segundo-Sargento', icon: 'fa-star' },
    { min: 800, nome: 'Primeiro-Sargento', icon: 'fa-star' },
    { min: 1200, nome: 'Suboficial', icon: 'fa-star-half-stroke' },
    { min: 1800, nome: 'Guarda-Marinha', icon: 'fa-award' },
    { min: 2500, nome: 'Segundo-Tenente', icon: 'fa-medal' },
    { min: 3500, nome: 'Primeiro-Tenente', icon: 'fa-medal' },
    { min: 5000, nome: 'Capitão-Tenente', icon: 'fa-shield' },
    { min: 7000, nome: 'Capitão de Corveta', icon: 'fa-shield' },
    { min: 9000, nome: 'Capitão de Fragata', icon: 'fa-shield' },
    { min: 12000, nome: 'Capitão de Mar e Guerra', icon: 'fa-shield' },
    { min: 16000, nome: 'Almirante', icon: 'fa-crown' }
  ];

  function patenteFor(totalAcertos) {
    var atual = PATENTES[0];
    for (var i = 0; i < PATENTES.length; i++) {
      if ((totalAcertos || 0) >= PATENTES[i].min) atual = PATENTES[i];
      else break;
    }
    return atual;
  }

  // ===================================================================
  // Sequência de estudo (streak) — calculada a partir das datas em que o
  // aluno tem pelo menos um resultado salvo (tabela `resultados`).
  // Não depende de nenhuma coluna nova nem de localStorage: funciona em
  // qualquer aparelho em que o aluno faça login.
  // ===================================================================
  function toDayKey(dateLike) {
    var d = new Date(dateLike);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function computeStreak(resultados) {
    if (!resultados || resultados.length === 0) return { atual: 0, recorde: 0, diasEstudados: 0 };

    var dayKeys = {};
    resultados.forEach(function (r) {
      if (r.criado_em) dayKeys[toDayKey(r.criado_em)] = true;
    });
    var uniqueDays = Object.keys(dayKeys);

    // Constrói um Set de timestamps (meia-noite) pra andar dia a dia.
    var daySet = {};
    uniqueDays.forEach(function (k) {
      var parts = k.split('-').map(Number);
      var t = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
      daySet[t] = true;
    });

    var oneDay = 24 * 60 * 60 * 1000;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var todayTime = today.getTime();

    // Streak atual: anda pra trás a partir de hoje (ou de ontem, se hoje
    // ainda não estudou — o streak continua "vivo" até o fim do dia).
    var atual = 0;
    var cursor = todayTime;
    if (!daySet[cursor]) cursor -= oneDay; // ainda não estudou hoje, tenta ontem
    while (daySet[cursor]) {
      atual++;
      cursor -= oneDay;
    }

    // Recorde: maior sequência de dias consecutivos já alcançada.
    var sortedTimes = Object.keys(daySet).map(Number).sort(function (a, b) { return a - b; });
    var recorde = 0, run = 0, prev = null;
    sortedTimes.forEach(function (t) {
      if (prev !== null && t - prev === oneDay) run++;
      else run = 1;
      if (run > recorde) recorde = run;
      prev = t;
    });

    return { atual: atual, recorde: recorde, diasEstudados: uniqueDays.length };
  }

  // ===================================================================
  // Estatísticas pessoais agregadas — usadas na aba "Meu Progresso" do
  // ranking e pra decidir quais conquistas já foram desbloqueadas.
  // ===================================================================
  function personalStats(resultados) {
    resultados = resultados || [];
    var totalSimulados = resultados.length;
    var totalAcertos = 0, totalErros = 0;
    var materiasFeitas = {};
    var melhorNota = 0;
    var notaCem = false;

    resultados.forEach(function (r) {
      totalAcertos += (r.acertos || 0);
      totalErros += (r.erros || 0);
      if (r.quiz_id) materiasFeitas[r.quiz_id] = true;
      if (typeof r.percentual === 'number') {
        if (r.percentual > melhorNota) melhorNota = r.percentual;
        if (r.percentual >= 100) notaCem = true;
      }
    });

    var totalQuestoes = totalAcertos + totalErros;
    var percentualMedio = totalQuestoes > 0 ? Math.round((totalAcertos / totalQuestoes) * 1000) / 10 : 0;

    // Evolução cronológica (mais antigo -> mais recente) do % de acerto,
    // pra desenhar um gráfico simples de linha.
    var evolucao = resultados
      .filter(function (r) { return r.criado_em && typeof r.percentual === 'number'; })
      .sort(function (a, b) { return new Date(a.criado_em) - new Date(b.criado_em); })
      .map(function (r) { return { data: r.criado_em, percentual: r.percentual, materia: r.quiz_id }; });

    return {
      totalSimulados: totalSimulados,
      totalAcertos: totalAcertos,
      totalErros: totalErros,
      totalQuestoes: totalQuestoes,
      percentualMedio: percentualMedio,
      melhorNota: melhorNota,
      notaCem: notaCem,
      materiasDistintas: Object.keys(materiasFeitas).length,
      materiasFeitas: materiasFeitas,
      evolucao: evolucao
    };
  }

  // ===================================================================
  // Conquistas (badges) — cada uma tem um id estável (pra lembrar quais já
  // foram vistas, via localStorage) e uma condição calculada em cima das
  // estatísticas já buscadas pela própria página (sem chamadas extras).
  // ===================================================================
  function computeBadges(resultados) {
    var stats = personalStats(resultados);
    var streak = computeStreak(resultados);
    var quizCount = {};
    resultados.forEach(function (r) { quizCount[r.quiz_id] = (quizCount[r.quiz_id] || 0) + 1; });

    var defs = [
      { id: 'primeiro-passo', label: 'Primeiro Passo', desc: 'Concluiu o primeiro simulado', icon: 'fa-shoe-prints', unlocked: stats.totalSimulados >= 1 },
      { id: 'maratonista', label: 'Maratonista', desc: '10 simulados concluídos', icon: 'fa-person-running', unlocked: stats.totalSimulados >= 10 },
      { id: 'veterano', label: 'Veterano', desc: '50 simulados concluídos', icon: 'fa-medal', unlocked: stats.totalSimulados >= 50 },
      { id: 'lenda', label: 'Lenda da Plataforma', desc: '100 simulados concluídos', icon: 'fa-crown', unlocked: stats.totalSimulados >= 100 },
      { id: 'sequencia-3', label: 'Sequência de Ferro', desc: '3 dias seguidos de estudo', icon: 'fa-fire', unlocked: streak.recorde >= 3 },
      { id: 'sequencia-7', label: 'Disciplina Naval', desc: '7 dias seguidos de estudo', icon: 'fa-fire-flame-curved', unlocked: streak.recorde >= 7 },
      { id: 'sequencia-30', label: 'Inabalável', desc: '30 dias seguidos de estudo', icon: 'fa-anchor', unlocked: streak.recorde >= 30 },
      { id: 'atirador-elite', label: 'Atirador de Elite', desc: 'Média geral acima de 80% (mín. 5 simulados)', icon: 'fa-bullseye', unlocked: stats.totalSimulados >= 5 && stats.percentualMedio >= 80 },
      { id: 'nota-mil', label: 'Nota 1000', desc: 'Gabaritou (100%) um simulado', icon: 'fa-star', unlocked: stats.notaCem },
      { id: 'mil-acertos', label: 'Milhar de Acertos', desc: '1.000 questões corretas no total', icon: 'fa-layer-group', unlocked: stats.totalAcertos >= 1000 },
      { id: 'estudioso-estatuto', label: 'Estudioso do Estatuto', desc: '3+ simulados em Estatuto & RDM', icon: 'fa-book', unlocked: (quizCount.ESTATUTO_RDM || 0) >= 3 },
      { id: 'explorador', label: 'Explorador', desc: 'Já estudou em 6+ matérias diferentes', icon: 'fa-compass', unlocked: stats.materiasDistintas >= 6 },
      { id: 'completo', label: 'Almirantado Completo', desc: 'Já estudou em todas as ' + TOTAL_SUBJECTS + ' matérias', icon: 'fa-ship', unlocked: stats.materiasDistintas >= TOTAL_SUBJECTS }
    ];
    return defs;
  }

  // Compara as conquistas atuais com as últimas vistas (guardadas no
  // localStorage, por usuário) e devolve só as que acabaram de ser
  // desbloqueadas — pra disparar a celebração só uma vez.
  function newlyUnlockedBadges(userId, badges) {
    var key = 'alfa_badges_seen_' + userId;
    var seen = [];
    try { seen = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { seen = []; }
    var unlockedIds = badges.filter(function (b) { return b.unlocked; }).map(function (b) { return b.id; });
    var novas = unlockedIds.filter(function (id) { return seen.indexOf(id) === -1; });
    try { localStorage.setItem(key, JSON.stringify(unlockedIds)); } catch (e) { /* localStorage indisponível: ignora */ }
    return badges.filter(function (b) { return novas.indexOf(b.id) !== -1; });
  }

  // ===================================================================
  // Frases motivacionais — uma por dia (determinística, todo mundo vê a
  // mesma no mesmo dia, e ela não muda a cada F5).
  // ===================================================================
  var FRASES = [
    'Disciplina é a ponte entre objetivos e conquistas.',
    'Cada questão respondida hoje é um passo mais perto da farda.',
    'A aprovação se constrói na repetição diária, não na véspera da prova.',
    'Quem estuda com constância não teme a hora da prova.',
    'Um bom marinheiro se prepara antes da tempestade chegar.',
    'Foco no processo — o resultado é consequência.',
    'Errar uma questão hoje é aprender pra não errar amanhã.',
    'A rotina vence o talento quando o talento não tem rotina.',
    'Sua aprovação começa na próxima questão que você resolver.',
    'Constância é o que separa quem sonha de quem conquista.',
    'Não é sobre ser o mais rápido, é sobre não parar de remar.',
    'Cada simulado concluído é um tijolo na sua aprovação.',
    'A disciplina de hoje é a liberdade de amanhã.',
    'Estude como se a prova fosse amanhã, revise como se fosse pra sempre.',
    'Grandes resultados vêm de pequenos esforços repetidos todos os dias.',
    'O cansaço passa, a desistência é que fica pra sempre.',
    'Firme no leme, mesmo quando o mar balança.',
    'A aprovação não é sorte — é planejamento encontrando preparo.',
    'Persistência é o combustível de quem quer vestir a farda.',
    'Não compare seu dia 1 com o dia 100 de outra pessoa.',
    'Revisar o que errou vale mais do que repetir o que já sabe.',
    'Sua melhor versão está do outro lado da constância.',
    'Cada dia de estudo é um voto de confiança no seu futuro.',
    'A caneta que aprova é a mesma que treinou todo santo dia.',
    'Onde há disciplina, o resultado é só uma questão de tempo.',
    'Confiança se constrói questão por questão, dia após dia.',
    'A jornada até a aprovação é longa — por isso não pode ser feita com pressa.',
    'Hoje é um bom dia pra fechar mais uma matéria com 100%.',
    'O que parece impossível hoje vira rotina depois de disciplina.',
    'Marinheiro de primeira viagem também chega a almirante.'
  ];

  function fraseDoDia() {
    var d = new Date();
    var start = new Date(d.getFullYear(), 0, 0);
    var diff = d - start;
    var dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));
    return FRASES[dayOfYear % FRASES.length];
  }

  // ===================================================================
  // Celebração visual (confete) — canvas leve, sem nenhuma biblioteca
  // externa (funciona mesmo offline / sem acesso a CDN).
  // ===================================================================
  function celebrar(opts) {
    opts = opts || {};
    var duracaoMs = opts.duracao || 2400;
    var cores = opts.cores || ['#e0c26f', '#c9a44c', '#0066cc', '#34d399', '#f43f5e', '#ffffff'];

    var canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '9999';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var count = Math.min(160, Math.max(60, Math.floor(window.innerWidth / 8)));
    var particles = [];
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.3,
        w: 6 + Math.random() * 6,
        h: 8 + Math.random() * 10,
        vx: (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 3.5,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.3,
        color: cores[Math.floor(Math.random() * cores.length)]
      });
    }

    var startTime = performance.now();
    function frame(now) {
      var elapsed = now - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(function (p) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (elapsed < duracaoMs) {
        requestAnimationFrame(frame);
      } else {
        canvas.remove();
      }
    }
    requestAnimationFrame(frame);
  }

  // Um toast simples (canto superior), usado pra anunciar conquista nova.
  function toastConquista(badge) {
    var el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%) translateY(-12px);' +
      'background:#0B192C;border:1px solid #e0c26f;color:#fff;padding:12px 18px;border-radius:12px;' +
      'box-shadow:0 12px 30px rgba(0,0,0,.35);z-index:10000;font-family:Inter,system-ui,sans-serif;' +
      'font-size:13px;display:flex;align-items:center;gap:10px;opacity:0;transition:opacity .3s,transform .3s;max-width:90vw;';
    el.innerHTML = '<i class="fa-solid ' + (badge.icon || 'fa-medal') + '" style="color:#e0c26f;font-size:18px;"></i>' +
      '<span><strong>Conquista desbloqueada:</strong> ' + badge.label + '</span>';
    document.body.appendChild(el);
    requestAnimationFrame(function () {
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(-12px)';
      setTimeout(function () { el.remove(); }, 350);
    }, 3600);
  }

  // ===================================================================
  // Extração de questões de outra página do site (mesma origem) — usada
  // pelo jogo da memória e pelo caderno de erros pra reaproveitar os
  // bancos de questões já existentes em cada matéria, sem duplicar
  // conteúdo em um novo arquivo.
  // ===================================================================
  function extractQuestionsFromHtml(html) {
    var marker = 'const questionsData';
    var idx = html.indexOf(marker);
    if (idx === -1) return null;
    var eq = html.indexOf('=', idx);
    var arrStart = html.indexOf('[', eq);
    if (arrStart === -1) return null;

    // Varre caractere a caractere contando colchetes/chaves, respeitando
    // strings (aspas simples/duplas/template) pra achar o `]` correspondente,
    // já que o array pode ter milhares de linhas.
    var depth = 0, inString = null, i = arrStart, end = -1;
    for (; i < html.length; i++) {
      var c = html[i];
      if (inString) {
        if (c === '\\') { i++; continue; }
        if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return null;

    var arrayLiteral = html.slice(arrStart, end + 1);
    try {
      // eslint-disable-next-line no-new-func
      var fn = new Function('return (' + arrayLiteral + ');');
      return fn();
    } catch (e) {
      console.warn('[gamification] falha ao extrair questionsData:', e);
      return null;
    }
  }

  async function fetchSubjectQuestions(quizId) {
    var info = SUBJECTS[quizId];
    if (!info || !info.url) return null;
    try {
      var resp = await fetch(info.url, { cache: 'no-store' });
      if (!resp.ok) return null;
      var html = await resp.text();
      return extractQuestionsFromHtml(html);
    } catch (e) {
      console.warn('[gamification] falha ao buscar', quizId, e);
      return null;
    }
  }

  // ===================================================================
  // Acesso offline — cache do último "aprovado" + lista de matérias
  // liberadas, pra tela de acesso não travar em "Verificando seu
  // acesso..." pra sempre quando o aparelho está sem internet.
  //
  // Como funciona: cada página continua chamando o Supabase normalmente,
  // mas através de fetchAprovado/fetchQuizAccess/fetchAllAccess abaixo.
  // Numa consulta bem-sucedida (com internet), o resultado é salvo aqui.
  // Se uma consulta falhar (sem internet), a função devolve o último
  // valor salvo em vez de travar a página — e só mostra a tela de "sem
  // conexão" se nem isso existir (ou seja, o aluno nunca abriu essa
  // página com internet antes).
  // ===================================================================
  var ACCESS_CACHE_PREFIX = 'alfa_access_cache_';

  function getAccessCache(userId) {
    try {
      var raw = localStorage.getItem(ACCESS_CACHE_PREFIX + userId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeAccessCache(userId, patch) {
    try {
      var current = getAccessCache(userId) || { aprovado: false, quizIds: [] };
      var next = {
        aprovado: 'aprovado' in patch ? patch.aprovado : current.aprovado,
        quizIds: patch.quizIds || current.quizIds || [],
        ts: Date.now()
      };
      localStorage.setItem(ACCESS_CACHE_PREFIX + userId, JSON.stringify(next));
    } catch (e) { /* localStorage indisponível: segue sem cache */ }
  }

  function setAccessCacheAprovado(userId, aprovado) {
    writeAccessCache(userId, { aprovado: aprovado });
  }

  function setAccessCacheQuiz(userId, aprovado, quizId, hasAccess) {
    var current = getAccessCache(userId);
    var setIds = {};
    ((current && current.quizIds) || []).forEach(function (q) { setIds[q] = true; });
    if (hasAccess) setIds[quizId] = true; else delete setIds[quizId];
    writeAccessCache(userId, { aprovado: aprovado, quizIds: Object.keys(setIds) });
  }

  function setAccessCacheFull(userId, aprovado, quizIds) {
    writeAccessCache(userId, { aprovado: aprovado, quizIds: quizIds });
  }

  // Reaproveita a mesma tela de acesso que cada página já tem (o painel
  // #gate-checking) pra avisar que está offline e sem dados salvos —
  // não precisa de nenhum HTML novo em nenhuma página.
  function showOfflineGate() {
    try {
      var screen = document.getElementById('access-screen');
      var panel = document.getElementById('gate-checking');
      if (!screen || !panel) return;
      ['gate-checking', 'gate-logged-out', 'gate-pending', 'gate-no-access'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.add('hidden');
        el.classList.remove('flex');
      });
      panel.classList.remove('hidden');
      panel.classList.add('flex');
      screen.classList.remove('hidden');
      var p = panel.querySelector('p');
      if (p) p.textContent = 'Sem conexão com a internet, e ainda não há dados salvos neste aparelho. Conecte-se pelo menos uma vez para liberar o uso offline.';
      var icon = panel.querySelector('i');
      if (icon) icon.className = 'fa-solid fa-wifi text-2xl text-amber-300';
    } catch (e) { /* ignora */ }
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
      return (res.data || []).map(function (a) { return a.quiz_id; });
    } catch (e) {
      var cached = getAccessCache(userId);
      return cached ? (cached.quizIds || []) : [];
    }
  }

  // ===================================================================
  // Foto de perfil — upload pro bucket "avatars" do Supabase Storage e
  // atualização da coluna profiles.avatar_url. Requer que o usuário rode
  // o supabase_avatar_setup.sql uma vez (cria a coluna + o bucket + as
  // políticas de acesso).
  // ===================================================================
  var AVATAR_MAX_BYTES = 3 * 1024 * 1024; // 3 MB

  function initialFor(nomeOuEmail) {
    var base = (nomeOuEmail || '?').trim();
    return base ? base.charAt(0).toUpperCase() : '?';
  }

  async function uploadAvatar(sb, userId, file) {
    if (!file) throw new Error('Nenhum arquivo selecionado.');
    if (!/^image\//.test(file.type)) throw new Error('Escolha um arquivo de imagem (JPG, PNG ou WEBP).');
    if (file.size > AVATAR_MAX_BYTES) throw new Error('Imagem muito grande (máx. 3 MB).');

    var ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : 'jpg';
    var path = userId + '/avatar.' + ext;

    var upload = await sb.storage.from('avatars').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upload.error) throw upload.error;

    var pub = sb.storage.from('avatars').getPublicUrl(path);
    var publicUrl = pub.data.publicUrl + '?v=' + Date.now(); // cache-bust pra trocar de foto na hora

    var update = await sb.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
    if (update.error) throw update.error;

    return publicUrl;
  }

  global.AlfaGamification = {
    SUBJECTS: SUBJECTS,
    TOTAL_SUBJECTS: TOTAL_SUBJECTS,
    labelFor: labelFor,
    diasParaProva: diasParaProva,
    PATENTES: PATENTES,
    patenteFor: patenteFor,
    initialFor: initialFor,
    uploadAvatar: uploadAvatar,
    computeStreak: computeStreak,
    personalStats: personalStats,
    computeBadges: computeBadges,
    newlyUnlockedBadges: newlyUnlockedBadges,
    fraseDoDia: fraseDoDia,
    celebrar: celebrar,
    toastConquista: toastConquista,
    extractQuestionsFromHtml: extractQuestionsFromHtml,
    fetchSubjectQuestions: fetchSubjectQuestions,
    getAccessCache: getAccessCache,
    setAccessCacheAprovado: setAccessCacheAprovado,
    setAccessCacheQuiz: setAccessCacheQuiz,
    setAccessCacheFull: setAccessCacheFull,
    showOfflineGate: showOfflineGate,
    fetchAprovado: fetchAprovado,
    fetchQuizAccess: fetchQuizAccess,
    fetchAllAccess: fetchAllAccess
  };
})(window);
