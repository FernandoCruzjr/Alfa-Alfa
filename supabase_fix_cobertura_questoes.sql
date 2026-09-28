-- =====================================================================
-- Plataforma de Estudos CA-AA/AFN — Correção da cobertura de questões
-- =====================================================================
-- O QUE É ISSO
-- A tela "Cobertura do Banco de Questões" conta, por matéria, quantas
-- questões DISTINTAS você já respondeu, lendo a tabela
-- respostas_detalhadas. Até agora, cada questão só era gravada nessa
-- tabela na PRIMEIRA vez que o app achava que você ainda não tinha
-- respondido ela (olhando um estado local de "retomar de onde parei").
-- Se essa gravação falhasse uma única vez (rede instável, etc.), aquela
-- questão nunca mais era reenviada — mesmo você respondendo ela de novo
-- depois — porque o app continuava achando "essa aqui eu já mandei".
-- Isso é o que fazia a cobertura mostrada ficar presa num número bem
-- menor do que o que você realmente já estudou (ex.: aparecer 51 sendo
-- que você já passou por mais de 100 questões).
--
-- O código já foi corrigido (agora grava de novo sempre que você
-- responde, e o próprio site se autocorrige toda vez que você abre um
-- quiz com progresso salvo). Este script SQL faz a parte que só pode ser
-- feita direto no banco:
--   1. Remove linhas duplicadas que possam existir hoje em
--      respostas_detalhadas (mesma questão, mesma matéria, mesmo aluno,
--      gravada mais de uma vez).
--   2. Cria uma regra de unicidade (aluno + matéria + questão) — é o que
--      permite ao site "atualizar" uma linha existente em vez de duplicar
--      quando você reconfere uma questão já respondida.
--
-- COMO USAR
-- 1. Abra seu projeto em https://supabase.com/dashboard
-- 2. Vá em "SQL Editor" (menu lateral) → "New query"
-- 3. Cole TODO o conteúdo deste arquivo e clique em "Run"
-- 4. Pronto — não precisa rodar de novo depois. Pode rodar de novo sem
--    medo (o script foi escrito pra não duplicar nada nem dar erro se
--    já tiver sido rodado antes).
-- 5. Depois de rodar, é só abrir qualquer quiz que você já tenha algum
--    progresso salvo (ex.: Documentação Administrativa) — o site vai
--    detectar sozinho o que estava faltando em respostas_detalhadas e
--    completar automaticamente. Não precisa refazer as questões.
-- =====================================================================

-- 1) Remove duplicatas existentes (mantém só a linha mais recente de
--    cada combinação aluno + matéria + questão).
DELETE FROM respostas_detalhadas a
USING respostas_detalhadas b
WHERE a.user_id = b.user_id
  AND a.quiz_id = b.quiz_id
  AND a.question_id = b.question_id
  AND a.ctid < b.ctid;

-- 2) Cria a constraint de unicidade, se ainda não existir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'respostas_detalhadas_user_quiz_question_key'
  ) THEN
    ALTER TABLE respostas_detalhadas
      ADD CONSTRAINT respostas_detalhadas_user_quiz_question_key
      UNIQUE (user_id, quiz_id, question_id);
  END IF;
END $$;
