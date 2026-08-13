# 🏡 Quintal — Controle das casas de aluguel

Sistema web para controlar as 7 casas do quintal: lançar as contas do mês, ratear entre os
inquilinos, marcar quem pagou o quê e gerar as mensagens de cobrança prontas para o WhatsApp —
com preview e confirmação antes de qualquer envio.

Versão 3.0 — reescrita completa (visual e lógica).

---

## O que ele faz

| Tela | Para quê |
|---|---|
| **Mês** (`/`) | Lança água, as duas contas de luz e os vencimentos. Mostra o rateio pronto e a marcação de pago item por item. |
| **Casas** (`/casas`) | Cadastro: inquilino, telefone, aluguel, **moradores** (as cabeças que dividem a água), relógio de luz. |
| **WhatsApp** (`/whatsapp`) | Gera a mensagem individual de cada inquilino, mostra o **preview**, exige **confirmação** e só então libera a fila de envio (copiar / abrir conversa). Tem campo de **teste**. |
| **Histórico** (`/historico`) | Abas mês a mês, com o que foi cobrado, recebido e o que ficou em aberto, além da evolução por casa. |
| **Repasse** (`/repasse`) | Split 50/50 do aluguel recebido entre pai e mãe, com descontos individuais. |
| **Regras** (`/regras`) | As 15 regras de convivência do quintal — editáveis, prontas para imprimir ou mandar no grupo. |

---

## As regras de cálculo

### Água — dividida por cabeça
```
valor_por_cabeca = agua_total / (soma dos moradores das casas OCUPADAS)
casa.agua        = valor_por_cabeca × moradores da casa
```
Casa vaga não paga e não entra na divisão. Quem tem mais gente em casa paga mais.

### Luz — duas contas, uma por relógio
- **Relógio 1** → casas 1, 2 e 3
- **Relógio 2** → casas 4, 5, 6 e 7

```
casa.luz = (valor_total_do_relogio / soma dos pesos das casas ocupadas naquele relógio) × peso da casa
```
`peso_luz` é 1 por padrão (divisão igual). Ajuste no cadastro se alguma casa consome mais.

### Aluguel
Vem do cadastro da casa quando o mês é criado e pode ser ajustado naquele mês específico.

### Pagamento
Cada casa tem 4 itens cobráveis — **água, luz, outros e aluguel** — e cada um é marcado
separadamente, guardando a data em que foi pago. A casa só fica "quitada" quando todos os
itens com valor estão pagos.

### Vencimentos
São datas completas: uma para a água, uma para **cada** conta de luz e uma para o aluguel.
As telas mostram "vence em X dias", "vence hoje" ou "venceu há X dias", e a data entra
automaticamente na mensagem do WhatsApp.

### Repasse pai/mãe
```
bruto de cada um = 50% do aluguel efetivamente PAGO no mês
líquido          = bruto − descontos daquele destinatário
```

O controle começa em **abril/2026**; meses anteriores não são listados.

---

## O envio de WhatsApp (fluxo)

O sistema **não envia nada sozinho** — ele prepara e você envia:

1. **Preview** — escolhe o mês e o modelo (cobrança, lembrete ou recibo) e vê todas as
   mensagens, uma por inquilino, do jeito que vão sair. Dá para desmarcar quem não deve
   receber e editar o texto de qualquer uma.
2. **Confirmar** — o botão de confirmação mostra o resumo ("6 mensagens • R$ 2.100,50").
   Antes de confirmar, nenhum botão de envio aparece.
3. **Fila** — um item por inquilino, com "copiar texto" e "abrir WhatsApp". Cada um que você
   aciona fica marcado como enviado, com barra de progresso.

O **campo de teste** gera a mensagem para um número qualquer (com dados reais de uma casa ou
com uma casa fictícia de exemplo) sem marcar ninguém como enviado.

---

## Stack

- Node.js 20 + Express 4
- SQLite via better-sqlite3 (arquivo único em `data/quintal.db`, modo WAL)
- Frontend vanilla — HTML + CSS + JS, sem build step e sem CDN
- Docker + docker-compose

### Segurança do acesso
- Senha única (`APP_PASSWORD`, hash bcrypt em memória)
- Cloudflare Turnstile no login (se `TURNSTILE_SECRET_KEY` estiver configurado)
- Rate-limit: 8 falhas em 15 min bloqueiam o IP por 15 min
- 2FA por e-mail: código de 6 dígitos válido por 5 min (se o SMTP estiver configurado)
- Sessão em cookie HTTP-only, 30 dias, renovada a cada requisição

---

## Estrutura

```
index.js              servidor, login/2FA, rotas das páginas
modules/
  db.js               schema, migrations e seeds (7 casas + 15 regras)
  calculo.js          rateio de água e luz, pagamento, payload do mês
  mensagens.js        textos de WhatsApp (cobrança, lembrete, recibo, regras)
  api.js              rotas /api
  auth.js             senha + middleware de sessão
  logger.js           log com timestamp
public/
  css/app.css         design system (tokens + componentes)
  js/core.js          window.App: fetch, formatação, modais, toasts, nav
  *.html              uma página por tela
data/
  quintal.db          banco (volume persistente)
  backup/             backup do banco antigo (v2, aluguel.db)
```

---

## Rodando

```bash
cp .env.example .env     # configure APP_PASSWORD e SESSION_SECRET
./start.sh               # pull + build + up + health
```

Outros modos:
```bash
./start.sh restart        # stop + git pull + rebuild + start
./start.sh restart-local  # stop + start rápido, sem pull nem rebuild
```

Sem Docker:
```bash
npm install
npm start
```

### Variáveis de ambiente
| Variável | Para quê |
|---|---|
| `PORT` | porta interna do Express (padrão 3002) |
| `APP_PASSWORD` | senha de acesso — **obrigatória** |
| `SESSION_SECRET` | segredo do cookie (`openssl rand -hex 32`) |
| `COOKIE_SECURE` | `true` quando servido por HTTPS |
| `TZ` | `America/Sao_Paulo` |
| `TURNSTILE_SECRET_KEY` | captcha do login (opcional) |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `SMTP_FROM` `ALERT_EMAIL_TO` | 2FA por e-mail (opcional) |

---

## Primeiro uso

1. Entre em **Casas** e preencha os **telefones** (começam vazios — sem eles o WhatsApp não abre
   a conversa) e o número de **moradores** de cada casa, que é o que divide a conta de água.
2. Vá em **Mês**, lance o total da água, o total de cada relógio de luz e os vencimentos.
   Clique em *Salvar e calcular*.
3. Confira o rateio, vá em **WhatsApp**, veja o preview, confirme e dispare a fila.
4. Conforme o pessoal for pagando, marque cada item na tela do mês.

---

## Banco anterior

A versão 2 usava `data/aluguel.db`. Esse arquivo continua no lugar, intocado, e há uma cópia
consistente em `data/backup/`. A versão 3 usa um banco novo (`data/quintal.db`), com schema
diferente — água por cabeça, vencimentos como data completa e pagamento por item.
