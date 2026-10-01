-- =====================================================================
-- Plataforma de Estudos CA-AA/AFN — Permissão de gravação em
-- respostas_detalhadas (causa real de "nenhuma questão é contabilizada")
-- =====================================================================
-- O QUE ACONTECEU
-- Toda tabela nova neste projeto precisa de uma permissão específica
-- (RLS — Row Level Security) liberando cada aluno a gravar e ler as
-- PRÓPRIAS linhas. Essa permissão nunca foi criada pra respostas_detalhadas
-- (a tabela usada pela tela "Cobertura do Banco de Questões") — então,
-- mesmo com o código certo, TODA tentativa de gravar nessa tabela vinha
-- sendo recusada pelo banco, silenciosamente, desde o início, pra todo
-- mundo. É por isso que a Cobertura ficava sempre travada em zero (ou
-- quase), mesmo você respondendo centenas de questões: o app tentava
-- gravar, o banco recusava, e o app não tinha como te avisar disso na
-- hora. Já a tabela `resultados` (usada pelo total "questões certas" da
-- página inicial) já tinha essa permissão configurada desde sempre — por
-- isso aquele número sempre esteve certo.
--
-- O QUE ESTE SCRIPT FAZ
--   1. Liga a segurança por linha (RLS) na tabela, se ainda não estiver.
--   2. Cria as 3 permissões que faltavam: o aluno aprovado pode VER,
--      CRIAR e ATUALIZAR as próprias respostas detalhadas (nunca as de
--      outro aluno).
-- Pode rodar quantas vezes quiser sem medo — se a permissão já existir,
-- este script recria ela do zero (drop + create) em vez de duplicar ou
-- dar erro.
--
-- COMO USAR
-- 1. Abra seu projeto em https://supabase.com/dashboard
-- 2. Vá em "SQL Editor" (menu lateral) → "New query"
-- 3. Cole TODO o conteúdo deste arquivo e clique em "Run"
-- 4. Pronto. Depois disso, qualquer questão nova que você responder já
--    grava certinho na hora. E o gamification.js atualizado (que estou
--    te mandando junto) faz o site recuperar sozinho tudo que você já
--    tinha respondido antes e nunca tinha sido salvo — é só abrir cada
--    matéria uma vez (não precisa refazer nada) que ele completa
--    automaticamente a Cobertura com o que já foi feito.
-- =====================================================================

alter table public.respostas_detalhadas enable row level security;

drop policy if exists "Usuário vê suas próprias respostas detalhadas" on public.respostas_detalhadas;
create policy "Usuário vê suas próprias respostas detalhadas"
  on public.respostas_detalhadas for select
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

drop policy if exists "Usuário grava suas próprias respostas detalhadas" on public.respostas_detalhadas;
create policy "Usuário grava suas próprias respostas detalhadas"
  on public.respostas_detalhadas for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

drop policy if exists "Usuário atualiza suas próprias respostas detalhadas" on public.respostas_detalhadas;
create policy "Usuário atualiza suas próprias respostas detalhadas"
  on public.respostas_detalhadas for update
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  )
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );
