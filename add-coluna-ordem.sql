-- Corrige o bug da Cobertura do Banco: a ordem embaralhada de cada quiz
-- (botão "Embaralhar") era salva só no localStorage do aparelho, nunca no
-- banco de dados. Resultado: ao abrir o quiz num aparelho novo (ou com o
-- cache do navegador limpo), a ordem embaralhada não existia ali, e
-- respostas antigas (salvas pela POSIÇÃO na lista, não pelo id da questão)
-- ficavam coladas à questão errada na hora de contar a cobertura — fazendo
-- questões já respondidas em outro aparelho/sessão parecerem "não feitas".
--
-- Esta coluna nova guarda a ordem atual (lista de ids das questões) junto
-- com o resto do progresso salvo, sincronizada entre todos os aparelhos do
-- aluno. Rode este comando uma vez no SQL Editor do Supabase.

alter table public.progresso
  add column if not exists ordem jsonb;
