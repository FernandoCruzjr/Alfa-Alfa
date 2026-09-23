-- =====================================================================
-- Leitor de Apostilas — marca-texto (highlights)
-- =====================================================================
-- Rode UMA VEZ no SQL Editor do seu projeto Supabase e clique em "Run".
--
-- Cria a tabela `apostila_highlights`, que guarda os trechos que você
-- marcar com cor ao ler qualquer uma das apostilas em apostila-leitura.html.
-- Cada marcação pertence a um único usuário (RLS) e é identificada por:
--   apostila_slug  -> qual apostila (ex: "cerimonial", "ogsa", ...)
--   block_index    -> qual parágrafo dentro da apostila
--   start/end      -> em qual trecho (offset de caractere) do parágrafo
--   color          -> amarelo / verde / azul / rosa
--
-- Sem essa tabela, o marca-texto ainda funciona (fica salvo no navegador,
-- em localStorage), mas não sincroniza entre dispositivos. Depois de
-- rodar este script, a sincronização entre celular/computador passa a
-- funcionar automaticamente — não precisa mexer em mais nada no código.
-- =====================================================================

create table if not exists public.apostila_highlights (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  apostila_slug text not null,
  block_index integer not null,
  start_offset integer not null,
  end_offset integer not null,
  color text not null,
  criado_em timestamptz not null default now()
);

create index if not exists apostila_highlights_user_slug_idx
  on public.apostila_highlights (user_id, apostila_slug);

alter table public.apostila_highlights enable row level security;

drop policy if exists "Usuário vê suas próprias marcações" on public.apostila_highlights;
create policy "Usuário vê suas próprias marcações"
  on public.apostila_highlights for select
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

drop policy if exists "Usuário cria suas próprias marcações" on public.apostila_highlights;
create policy "Usuário cria suas próprias marcações"
  on public.apostila_highlights for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

drop policy if exists "Usuário atualiza suas próprias marcações" on public.apostila_highlights;
create policy "Usuário atualiza suas próprias marcações"
  on public.apostila_highlights for update
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

drop policy if exists "Usuário apaga suas próprias marcações" on public.apostila_highlights;
create policy "Usuário apaga suas próprias marcações"
  on public.apostila_highlights for delete
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.aprovado = true)
  );

-- =====================================================================
-- Como isso é usado no site
-- apostila-leitura.html lê/grava em `apostila_highlights` sempre que você
-- seleciona um trecho de texto e escolhe uma cor (ou apaga uma marcação).
-- Enquanto esta tabela não existir, o app detecta o erro automaticamente
-- e usa só o localStorage do navegador — nada quebra se você demorar pra
-- rodar este script.
-- =====================================================================
