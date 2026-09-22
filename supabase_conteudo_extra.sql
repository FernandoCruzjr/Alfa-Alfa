-- =====================================================================
-- Caderno de Estudos — Matérias personalizadas + Apostilas
-- =====================================================================
-- Rode UMA VEZ no SQL Editor do seu projeto Supabase e clique em "Run".
-- Cria duas coisas novas:
--
--   1. Tabela `resumos_custom` — guarda os tópicos de resumo que você
--      adicionar manualmente pela aba "Resumo Teórico" do Caderno de
--      Estudos (além das matérias que já vêm prontas no código).
--
--   2. Tabela `apostilas` + bucket de Storage "apostilas" — guarda os
--      arquivos (PDF, Word etc.) que você enviar pela nova aba
--      "Apostilas" do Caderno de Estudos, organizados por matéria.
--      O bucket é PRIVADO (ao contrário do de fotos de perfil): só quem
--      está logado E aprovado consegue ver ou baixar os arquivos — é o
--      mesmo material que pode virar conteúdo pago no futuro.
--
-- Nesta primeira versão, qualquer aluno com acesso aprovado pode
-- adicionar/editar/apagar matérias personalizadas e apostilas — não há
-- ainda um papel de "administrador" separado na plataforma. Se no
-- futuro você quiser restringir isso só a você, é só avisar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Resumos personalizados
-- ---------------------------------------------------------------------
create table if not exists public.resumos_custom (
  id uuid primary key default gen_random_uuid(),
  materia text not null,
  titulo text not null,
  conteudo text not null,
  ordem integer not null default 0,
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

alter table public.resumos_custom enable row level security;

drop policy if exists "Aprovados veem resumos personalizados" on public.resumos_custom;
create policy "Aprovados veem resumos personalizados"
  on public.resumos_custom for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

drop policy if exists "Aprovados criam resumos personalizados" on public.resumos_custom;
create policy "Aprovados criam resumos personalizados"
  on public.resumos_custom for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

drop policy if exists "Aprovados editam resumos personalizados" on public.resumos_custom;
create policy "Aprovados editam resumos personalizados"
  on public.resumos_custom for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

drop policy if exists "Aprovados apagam resumos personalizados" on public.resumos_custom;
create policy "Aprovados apagam resumos personalizados"
  on public.resumos_custom for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

-- ---------------------------------------------------------------------
-- 2) Apostilas (metadados + bucket de Storage privado)
-- ---------------------------------------------------------------------
create table if not exists public.apostilas (
  id uuid primary key default gen_random_uuid(),
  materia text not null,
  titulo text not null,
  storage_path text not null,
  tamanho_bytes bigint,
  enviado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

alter table public.apostilas enable row level security;

drop policy if exists "Aprovados veem apostilas" on public.apostilas;
create policy "Aprovados veem apostilas"
  on public.apostilas for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

drop policy if exists "Aprovados registram apostilas" on public.apostilas;
create policy "Aprovados registram apostilas"
  on public.apostilas for insert
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

drop policy if exists "Aprovados apagam apostilas" on public.apostilas;
create policy "Aprovados apagam apostilas"
  on public.apostilas for delete
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

insert into storage.buckets (id, name, public)
values ('apostilas', 'apostilas', false)
on conflict (id) do update set public = false;

drop policy if exists "Aprovados leem arquivos de apostilas" on storage.objects;
create policy "Aprovados leem arquivos de apostilas"
  on storage.objects for select
  using (bucket_id = 'apostilas' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

drop policy if exists "Aprovados enviam arquivos de apostilas" on storage.objects;
create policy "Aprovados enviam arquivos de apostilas"
  on storage.objects for insert
  with check (bucket_id = 'apostilas' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

drop policy if exists "Aprovados apagam arquivos de apostilas" on storage.objects;
create policy "Aprovados apagam arquivos de apostilas"
  on storage.objects for delete
  using (bucket_id = 'apostilas' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true));

-- =====================================================================
-- Como isso é usado no site
-- A aba "Resumo Teórico" do caderno.html lê/grava em `resumos_custom`.
-- A aba "Apostilas" do caderno.html lê/grava em `apostilas` e envia os
-- arquivos pro bucket "apostilas" (link de download é sempre temporário,
-- gerado na hora — os arquivos nunca ficam com uma URL pública fixa).
-- =====================================================================
