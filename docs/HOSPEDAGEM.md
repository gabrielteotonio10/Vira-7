# Hospedagem gratuita (Render + Supabase)

O Vira-7 roda de graça e sem expirar com dois serviços:

| Serviço | O que faz | Custo |
| --- | --- | --- |
| **Render** | Roda a API em Python e entrega a página (tudo no mesmo endereço) | Plano *Free*, sem prazo e sem cartão |
| **Supabase** | Banco de dados, contas e tempo real | Plano *Free* (você já criou o projeto) |

Como a API serve a página, não há CORS nem domínio extra para configurar. Não precisa da Vercel.

## Antes de começar

- Projeto Supabase com as migrations aplicadas (`python scripts/migrate.py`).
- Conta no [GitHub](https://github.com) com o repositório do projeto e no [Render](https://render.com) (entre com o GitHub).
- A chave secreta (`service_role`/`secret`) **nunca** vai para o GitHub: ela só é digitada no painel do Render.

## 1. Enviar o código para o GitHub

O repositório já tem o remoto `origin`. Depois de fazer os commits:

```bash
git push origin main --tags
```

Confira se `backend/.env` **não** aparece no GitHub (o `.gitignore` já o exclui).

## 2. Criar o serviço no Render

1. No Render, clique em **New +** → **Blueprint**.
2. Escolha o repositório do Vira-7. O Render lê o arquivo [`render.yaml`](../render.yaml) e mostra o serviço `vira7` no plano **Free**.
3. Ele pede três valores. Copie do painel do Supabase (**Project Settings → API**):
   - `SUPABASE_URL`: a *Project URL*.
   - `SUPABASE_ANON_KEY`: a chave *publishable* (começa com `sb_publishable_`).
   - `SUPABASE_SERVICE_ROLE_KEY`: a chave *secret* (começa com `sb_secret_`).
4. Clique em **Apply**. O primeiro deploy leva de 3 a 5 minutos.
5. Quando ficar **Live**, abra o endereço do serviço (algo como `https://vira7.onrender.com`).
   Teste `…/api/health`: a resposta precisa ter `"mode":"supabase"`.

A cada `git push` na `main`, o Render publica a nova versão sozinho.

## 3. Avisar o Supabase do novo endereço

No Supabase, em **Authentication → URL Configuration**:

- **Site URL:** o endereço do Render (`https://vira7.onrender.com`).
- **Redirect URLs:** adicione `https://vira7.onrender.com/**` (e mantenha `http://localhost:8080/**` se testar no seu PC).

Sem isso, os links de confirmação de e-mail e de recuperação de senha apontam para o endereço errado.

## 4. Manter o serviço acordado (recomendado, grátis)

O plano gratuito do Render **dorme depois de 15 minutos sem acesso**. A primeira visita depois disso leva de 30 a 60 segundos. Um monitor gratuito evita isso:

1. Crie uma conta no [UptimeRobot](https://uptimerobot.com).
2. **Add New Monitor** → tipo **HTTP(s)**.
3. URL: `https://vira7.onrender.com/api/health`, intervalo de **5 minutos**.

Um serviço ligado o mês todo cabe nas 750 horas gratuitas do Render.

## 5. Testar o jogo

Abra o endereço em dois navegadores (ou em uma janela anônima e no celular), crie uma conta em cada, crie uma sala em uma e entre pelo código na outra.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| "Sem conexão com o servidor" | O serviço está acordando ou o deploy falhou | Espere 1 minuto; se continuar, veja **Logs** no Render |
| `/api/health` mostra `development-local` | Faltou `SUPABASE_URL` nas variáveis | Preencha em **Environment** e faça **Manual Deploy** |
| E-mail de confirmação abre `localhost` | Site URL do Supabase desatualizada | Refaça o passo 3 |
| Erro 429 "Muitas tentativas" | Limite de requisições atingido | Aguarde alguns segundos |
| Login recusado logo após criar a conta | Confirmação de e-mail pendente | Abra o link enviado ao e-mail |

## Segurança em produção

- As chaves ficam só nas variáveis do Render; o `render.yaml` não tem nenhum valor secreto.
- A documentação interativa da API (`/api/docs`) fica desligada com `APP_ENV=production`.
- Para trocar uma chave: gere outra no Supabase, atualize em **Environment** no Render e o serviço reinicia.
- O limite de requisições usa o IP do visitante (`TRUST_PROXY=true`), porque o Render fica na frente da API.
