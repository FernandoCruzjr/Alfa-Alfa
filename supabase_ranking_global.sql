-- =====================================================================
-- Plataforma de Estudos CA-AA/AFN — Ranking Geral (comparação entre alunos)
-- =====================================================================
-- O QUE É ISSO
-- Hoje suas tabelas (profiles, resultados, respostas_detalhadas, etc.) têm
-- RLS (Row Level Security) ativado e cada aluno só enxerga as PRÓPRIAS
-- linhas. Isso é ótimo pra privacidade, mas significa que o navegador de
-- um aluno NUNCA consegue, sozinho, montar um ranking com os dados de
-- outros alunos — a política de segurança bloqueia isso, e está certo
-- que bloqueie.
--
-- A forma correta e seguindo as boas práticas do Postgres/Supabase de
-- expor um resultado AGREGADO (nome + estatísticas gerais, nada de
-- respostas individuais) sem abrir brecha nas tabelas de baixo nível é
-- uma função "SECURITY DEFINER": ela roda com um privilégio elevado
-- (o do dono da função), mas só devolve exatamente as colunas agregadas
-- que definimos abaixo — nunca a tabela inteira. As tabelas originais
-- continuam 100% protegidas por RLS pra qualquer outro acesso.
--
-- COMO USAR
-- 1. Abra seu projeto em https://supabase.com/dashboard
-- 2. Vá em "SQL Editor" (menu lateral) → "New query"
-- 3. Cole TODO o conteúdo deste arquivo e clique em "Run"
-- 4. Pronto — não precisa rodar de novo depois, é uma configuração única.
--    Se quiser rodar de novo (por exemplo, pra atualizar a função), pode
--    rodar tranquilo: o script usa "CREATE OR REPLACE", então não duplica
--    nada nem apaga dados.
-- =====================================================================

-- Função que devolve o ranking geral: nome do aluno, quantos simulados
-- fez, quantas questões respondeu, quantos acertos, % média de acerto,
-- e a posição (1º, 2º, 3º...) de cada um. Só considera alunos com
-- aprovado = true (mesma regra de acesso já usada no resto da plataforma).
create or replace function public.get_ranking_geral()
returns table (
  user_id uuid,
  nome text,
  total_simulados bigint,
  total_questoes bigint,
  total_acertos bigint,
  percentual_medio numeric,
  posicao bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with agregado as (
    select
      r.user_id,
      count(*)                                   as total_simulados,
      sum(coalesce(r.acertos, 0) + coalesce(r.erros, 0)) as total_questoes,
      sum(coalesce(r.acertos, 0))                as total_acertos,
      round(avg(r.percentual)::numeric, 1)       as percentual_medio
    from public.resultados r
    group by r.user_id
  )
  select
    a.user_id,
    coalesce(p.nome, 'Aluno')                    as nome,
    a.total_simulados,
    a.total_questoes,
    a.total_acertos,
    a.percentual_medio,
    row_number() over (
      order by a.total_acertos desc, a.percentual_medio desc, a.total_simulados desc
    ) as posicao
  from agregado a
  join public.profiles p on p.id = a.user_id
  where p.aprovado = true
  order by posicao asc;
$$;

-- Qualquer usuário autenticado (logado) pode CHAMAR a função — mas ela só
-- devolve os campos agregados definidos acima, nunca as tabelas originais.
grant execute on function public.get_ranking_geral() to authenticated;

-- =====================================================================
-- Como isso é usado no site
-- A página ranking.html chama isso do navegador assim:
--   const { data, error } = await sb.rpc('get_ranking_geral');
-- e recebe uma lista já pronta, ordenada, com a posição de cada aluno —
-- sem nunca ter acesso direto às linhas de resultados de outra pessoa.
-- =====================================================================
