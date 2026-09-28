// Service Worker — Plataforma de Estudos CA-AA/AFN
// Estratégia:
//  - Páginas e assets do próprio site (mesma origem): network-first — busca sempre a rede
//    primeiro (e atualiza o cache com a resposta), só caindo pro cache se a rede falhar
//    (offline). Isso garante que conteúdo novo (apostilas, questões, links, o próprio
//    caderno.html etc.) apareça JÁ NA PRIMEIRA visita depois de publicado, sem precisar
//    recarregar cada matéria uma segunda vez pra "pegar" a atualização — que era o
//    comportamento antigo com stale-while-revalidate (sempre mostrava a versão em cache
//    primeiro e só atualizava o cache em segundo plano, pra próxima visita).
//  - Bibliotecas externas (Tailwind CDN, FontAwesome, Google Fonts, Supabase JS): continuam
//    stale-while-revalidate (cache-first com atualização em segundo plano) — essas praticamente
//    não mudam, então não há motivo pra pagar uma requisição de rede a cada vez, e isso mantém
//    o site utilizável offline mesmo assim.
//  - Chamadas à API do Supabase (autenticação, leitura/gravação de progresso): NUNCA cacheadas.
//    Precisam de rede de verdade; se estiver offline elas simplesmente falham (o app já cai pro
//    cache local via localStorage nesse caso).

const CACHE_VERSION = 'v6';
const CACHE_NAME = `caaa-afn-${CACHE_VERSION}`;

// Páginas do site a pré-cachear na instalação (exclui páginas órfãs sem link ativo no menu).
const PRECACHE_URLS = [
  './',
  'index.html',
  'manifest.json',
  'gamification.js',
  'anotacoes.html',
  'caaml-703.html',
  'caderno.html',
  'camaal-cav.html',
  'cerimonial.html',
  'cobertura-banco.html',
  'comandantes-navais.html',
  'desempenho.html',
  'doc-adm-mb.html',
  'estatuto-rdm.html',
  'jogo-memoria.html',
  'flashcards-caaml-703.html',
  'flashcards-camaal-cav.html',
  'flashcards-cerimonial.html',
  'flashcards-doc-adm-mb.html',
  'flashcards-estatuto-rdm.html',
  'flashcards-geografia.html',
  'flashcards-historia.html',
  'flashcards-justica-disciplina.html',
  'flashcards-lideranca.html',
  'flashcards-matematica.html',
  'flashcards-nodam.html',
  'flashcards-ogsa.html',
  'flashcards-pem2040.html',
  'flashcards-portugues.html',
  'flashcards-prova-simulada.html',
  'flashcards-rosas-virtudes.html',
  'geografia.html',
  'historia-naval.html',
  'historia-naval-fatos-1.html',
  'justica-disciplina.html',
  'lideranca.html',
  'lideranca-atributos.html',
  'linha-do-tempo-historia.html',
  'mapas-mentais.html',
  'matematica.html',
  'ogsa.html',
  'pem2040.html',
  'portugues.html',
  'prova-simulada.html',
  'ranking.html',
  'redacao.html',
  'rosas-virtudes.html',
  'icons/icon-72.png',
  'icons/icon-96.png',
  'icons/icon-128.png',
  'icons/icon-144.png',
  'icons/icon-152.png',
  'icons/icon-192.png',
  'icons/icon-384.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png'
];

// Hosts de CDN externos que o site usa e que também devem ficar disponíveis offline
// depois da primeira visita (não são pré-cacheados no install pra não travar a instalação
// esperando rede externa — são cacheados sob demanda, na primeira vez que cada um é buscado).
const RUNTIME_CACHE_HOSTS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'
];

// Nunca cachear chamadas à API do Supabase (autenticação e dados sempre precisam de rede real).
const SUPABASE_HOST = 'doioejeyihuhfqhzdbbq.supabase.co';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll falha inteiro se um item falhar; usamos add individual com catch
      // pra uma página faltando não impedir o cache de todo o resto.
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[sw] falhou ao pré-cachear', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('caaa-afn-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isRuntimeCacheHost(url) {
  return RUNTIME_CACHE_HOSTS.some((host) => url.hostname === host);
}

// Estratégia stale-while-revalidate (usada só pras libs externas): responde do cache na
// hora (se existir) e, em paralelo, busca na rede pra atualizar o cache pra próxima vez.
// Se não houver cache, espera a rede.
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          // Só cacheia respostas válidas (inclui 'opaque' de recursos cross-origin no-cors).
          if (response && (response.ok || response.type === 'opaque')) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached); // offline: cai pro cache se a rede falhar
      return cached || networkFetch;
    })
  );
}

// Estratégia network-first (usada pro próprio site): busca a rede primeiro; se der certo,
// atualiza o cache e responde com o que veio de lá — sempre a versão mais nova. Só usa o
// cache se a rede falhar (sem internet) ou não houver nada em cache ainda.
function networkFirst(request) {
  return caches.open(CACHE_NAME).then((cache) =>
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => cache.match(request))
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // nunca intercepta POST/PATCH/etc (ex: gravações no Supabase)

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Nunca cachear a API do Supabase (auth, leituras e gravações de progresso).
  if (url.hostname === SUPABASE_HOST) return;

  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin) {
    event.respondWith(networkFirst(req));
  } else if (isRuntimeCacheHost(url)) {
    event.respondWith(staleWhileRevalidate(req));
  }
  // Qualquer outra origem (não listada) segue o comportamento padrão do navegador, sem SW.
});
