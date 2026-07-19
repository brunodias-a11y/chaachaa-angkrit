# Milestone: Avatares para Alunos

**GitHub Milestone:** [#6 — Avatares para Alunos](https://github.com/brunodias-a11y/chaachaathai/milestone/6)
**Status:** ✅ Implementado (32/32 issues fechadas — inclui o sistema de poderes especiais, #184).
**Última atualização:** 2026-07-08

---

## Visão geral

Sistema completo de avatares desbloqueáveis, economia de moedas (Meowtongs) e bilhetes de Gacha, no estilo
"gatinho temático segurando uma bebida" (mesma identidade visual da logomarca ช้าช้าไทย). Todo aluno começa
com o avatar padrão `shadow-cat` (fora do pool de sorteio) e expande sua coleção por conquistas de estudo,
sorteios aleatórios, compra direta na loja ou bilhetes de Gacha.

## O que foi implementado (em ordem de entrega)

### Fundação (#161-#164)
- Campo `avatar` + `unlockedAvatars` no `profile` (KV, sem migração de schema Supabase)
- Catálogo de avatares no código (`AVATAR_CATALOG`: `id`, `name`, `image`, `shopExclusive`, `monthlyExclusive`, `rarity`)
- `grantRandomPrizeAvatar(profile)` — sorteia 1 avatar do pool que o aluno ainda não possui
- Seletor de avatar em Settings + redesign do cabeçalho (avatar 70x70 + divisor)

### Desbloqueios (#162, #165, #166)
- Fase 1 (4 critérios): primeiro streak, primeiro Sunday Test, primeira palavra em SRS Mastery +14, 7 dias de streak + Sunday Test
- **#165** — Conclusão de nível sorteia **2** avatares (reaproveita `grantRandomPrizeAvatar`, trava novas tentativas por nível)
- **#166** — 50 palavras em SRS Mastery +14 sorteia 1 avatar

### Economia de coins (#167) e Loja (#168, #172, #176)
- Fórmula de coins ligada ao desempenho (ver `docs/decisions.md` ADR-011 para a versão final, pós-rebalanceamento #198.1)
- Loja de avatares exclusivos comprados com coins (`shopExclusive`)
- Catálogo expandido em +9 avatares (#172)
- Professor pode presentear avatar da loja/Monthly Cat sem gastar coins do aluno (#176) — 1 gift grátis por nível
- **#212** — professor também pode presentear **coins** diretamente (mesma arquitetura de shared_kv + self-claim)

### Gacha System e UX de coleção (#177-#182)
- Animação de sorteio estilo gacha (#177)
- Contador "X/N coletados" (#178) + fallback quando o pool está esgotado (#179)
- Conquista "Colecionador" ao completar o pool sorteável (#180)
- "Gatinho do Mês" — challenges mensais estilo selos Duolingo (#181); professor sempre usa o avatar do mês corrente (#203)
- Toast + animação de ganho de Meowtongs (#182)

### Bilhetes de Gacha — Sistema #198 (sub-issues #207-#210)
- **#198.1** — Rebalanceamento: multipliers de coins reduzidos (Practice 0.6x, Sunday Test 1x, streak semanal 1.5x — teto ~670 Meowtongs/semana), preço mínimo por raridade (Raro 2.750, Épico 5.000, piso uniforme por enquanto)
- **#198.2** — Bilhete Raro (2.000 coins): sorteio de 4 cenários ponderados por esgotamento de Common/Uncommon, com escolha de manter ou reembolsar se o pool já estiver esgotado
- **#198.3** — Bilhete Épico (3.500 coins): sorteio de 8 cenários (combinações de esgotamento Common/Uncommon/Rare) + Cenário especial (todos os Épicos já possuídos → jackpot vira Lendário) + cashback automático se absolutamente tudo já foi coletado
- **#198.4** — Nova aba Gacha na tela de Loja: comprar/abrir bilhetes, modal de odds transparentes antes de cada sorteio, recompensas reaproveitando o pipeline de celebração existente (AvatarUnlockMoment/CoinsUnlockMoment)

### UI/UX de loja e celebrações (#182, #199-#206)
- Tela de Loja redesenhada: hero de avatar + segmentos Collection/Shop/Gacha (#205, corrigido em #206)
- Anéis de cor por raridade (Common/Uncommon/Rare/Epic/Legendary) no avatar circle e nos cards da loja (#204)
- Sequenciamento correto de celebrações simultâneas (achievement/coins/avatar) + animação de coin-shower restaurada (#201/#202)

### Teacher tab (#197, sub-issues #211-#212)
- Linha unificada de 4 botões de ação por aluno: Unlock Exam / Reset Access / Give avatar / Give coins,
  `flex:1` cada, 38-40px de altura (#211)
- Give coins as gift: modal com valores rápidos (10/25/50) ou custom, mesma arquitetura de shared_kv +
  self-claim do gift de avatar (#212)

## Poderes especiais (#184 + sub-issues #214, #216, #220, #222-224, #227-228, #286-289, #291, #293, #295)

Sistema completo entregue em duas ondas: primeiro o catálogo/mecânica (jul/07), depois o overhaul de UX que
alimenta o Phase 18 (jul/07-08).

- **`POWER_CATALOG`** — catálogo estático de poderes (simple/special/passive), cada um com `appliesTo`
  (lista de atividades onde é relevante — `"practice"`, `"sundayTest"`, `"exam"`) — ver ADR-016
- **`AVATAR_POWERS_CONFIG`** — mapeamento avatar → poderes atribuídos (editável pelo professor), com suporte
  a **2 passivas simultâneas** por avatar (`passive` + `passive2`, #295) além de consumíveis (simple/special)
- Avatares Rare+/Epic/Legendary podem carregar mais de um poder ao mesmo tempo (#224)
- Janelas de horário (`POWER_TIME_WINDOWS`) reorganizadas com nomes descritivos (Morning Cat, No afternoon
  nap, The night is a cat, Bring more coffee) em vez do genérico "+50% (window)" (#287)
- Todos os 14 poderes renomeados com emoji + nome criativo em PT/EN/TH (#291); descrições internas de dev
  (referências a issues) removidas do texto visível (#288)
- `PowerBar` — mostra o avatar equipado (imagem 68x68), filtra poderes por relevância de atividade
  (`appliesTo` + prop `activity`), tooltip on-tap (`PowerInfoTip`) em vez de texto sempre visível, título
  "[Avatar] is helping you:" + link pra trocar de avatar (#286, #289, #293)
- Poder morto identificado e removido: `sundaytest_countdown_25` nunca fazia nada (Sunday Test/Exam não têm
  cronômetro) — substituído por uma passiva negativa real, "😾Not today" (-25% countdown, Practice) (#295)
- Professor pode adicionar novos gatinhos via UI (catálogo dinâmico, não só código) — #223 + sub-issues #227/#228
- Modal de detalhes do avatar (raridade, estrelas, habilidades) na Collection/Shop — #222

Ver **Phase 18** (`CHANGELOG.md`) e ADR-016/ADR-017 (`docs/decisions.md`) para o `PreActivityFlow` que
consome esse sistema antes de cada atividade.

## Arquitetura (arquivos/funções-chave)

- `AVATAR_CATALOG` — catálogo estático no código
- `grantRandomPrizeAvatar(profile)` — sorteio de avatar
- `sendAvatarGift` / `claimPendingAvatarGift` / `AVATAR_GIFT_PREFIX` — gift de avatar professor→aluno (shared_kv, self-claim)
- `sendCoinGift` / `claimPendingCoinGift` / `COIN_GIFT_PREFIX` — gift de coins professor→aluno (mesmo padrão)
- `creditCoins(amount)` — única função que altera `COINS_KEY` (personal_kv); usa `storageGetSafe` (ADR-014)
  pra nunca sobrescrever o saldo real por causa de uma falha de leitura silenciosa
- Tabelas/resolvers de cenário do Gacha (Raro/Épico) — funções top-level em `App.jsx`, reutilizáveis/testáveis
  independente da UI
- `POWER_CATALOG` / `AVATAR_POWERS_CONFIG` / `getActivePowersForActivity()` — catálogo de poderes,
  atribuição por avatar e a lógica de relevância por atividade (ADR-016)
- `PreActivityFlow` — componente de escolha de avatar + ativação de poderes usado por Practice Mode, Sunday
  Test e Exame de Proficiência antes de iniciar (ADR-017)
