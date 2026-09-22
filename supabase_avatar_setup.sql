-- =====================================================================
-- Setup de foto de perfil (avatar) — rode UMA VEZ no SQL Editor do seu
-- projeto Supabase e clique em "Run". Depois disso qualquer aluno já
-- pode trocar a própria foto pela bolinha no topo da plataforma.
--
-- O que este script faz:
--   1. Adiciona a coluna `avatar_url` na tabela `profiles` (se não existir).
--   2. Cria um bucket de Storage público chamado "avatars".
--   3. Cria políticas de acesso: qualquer pessoa pode VER as fotos (é só
--      uma foto de perfil pública, como em qualquer rede social), mas só
--      o próprio aluno pode enviar/trocar a SUA foto (a pasta é o próprio
--      user_id, então ninguém consegue sobrescrever a foto de outra
--      pessoa).
-- =====================================================================

alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Qualquer pessoa (inclusive anônima) pode ler as fotos — é isso que
-- permite que a foto apareça pra outros alunos no ranking, por exemplo.
drop policy if exists "Avatares são publicamente visíveis" on storage.objects;
create policy "Avatares são publicamente visíveis"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Um usuário autenticado só pode enviar/atualizar/apagar arquivos dentro
-- da SUA PRÓPRIA pasta (o primeiro pedaço do caminho precisa ser o seu
-- próprio user_id) — assim ninguém troca a foto de outra pessoa.
drop policy if exists "Aluno envia sua própria foto" on storage.objects;
create policy "Aluno envia sua própria foto"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Aluno atualiza sua própria foto" on storage.objects;
create policy "Aluno atualiza sua própria foto"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Aluno apaga sua própria foto" on storage.objects;
create policy "Aluno apaga sua própria foto"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
