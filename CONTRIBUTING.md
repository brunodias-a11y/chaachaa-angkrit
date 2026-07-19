# Contributing to Chaa Chaa Thai

## Commits

**Every commit must reference an issue number.** No exceptions — even hotfixes and infrastructure changes.

Format:

```
<type>(#NN): <description>

feat(#42): add level progress bar
fix(#76): fuzzy dedupe for word import
fix(#94): missing comma in lucide-react import
docs(#69): add STT test results analysis
```

Types: `feat`, `fix`, `docs`, `refactor`, `chore`, `hotfix`, `style`, `test`

If a fix doesn't have an issue yet, **create the issue first** (even retroactively), then reference it.

## Issues

### Labels

| Label | When to use |
|---|---|
| `bug` | Something is broken |
| `feature` | New functionality |
| `enhancement` | Improvement to existing feature |
| `ui` | Visual / UX change |
| `study` | Research / spike — scope not yet defined |
| `needs-spec` | Scope not yet defined — needs investigation before implementation can start |
| `needs-decision` | Requires input before proceeding |
| `build` | Build / CI / CD failure (Vite, Wrangler, esbuild) |
| `infra` | Infrastructure: Cloudflare Functions, env vars, deployment |
| `hotfix` | Urgent fix applied directly to main (usually blocking) |
| `stt-infra` | STT test infrastructure — test page, reporting API |
| `documentation` | Docs improvements |
| `import` | PowerPoint import pipeline |
| `teacher-home` | Teacher role Home tab |
| `content` | Content / data (stroke paths, word lists, etc.) |
| `berserk-mode` | Berserk Mode feature |
| `priority-low` | Nice-to-have, no urgency |
| `priority-next` | Prioritized ahead of other planned phases |
| `priority-soon` | Next up after current priority-next work, not urgent yet |
| `backlog` | Scoped but intentionally not started — usually waiting on a decision or a prerequisite |
| `phase-10` | Thai Calligraphy Training milestone |
| `phase-11` | Level Progression & Proficiency Exam milestone |
| `phase-12` | Speaking Practice / Pronunciation Recognition milestone |
| `phase-13` | Berserk Mode milestone |
| `phase-14` | Sunday Test Engine Expansion milestone |
| `phase-19` | Gacha Special Banners (Solstice Ticket) milestone |
| `phase-20` | UX/UI de Lançamento Beta milestone |
| `phase-21` | Lesson Path milestone |
| `good first issue` | Good for newcomers |
| `help wanted` | Extra attention needed |
| `duplicate` | Already exists |
| `invalid` | Not applicable |
| `wontfix` | Will not be addressed |
| `question` | Further information requested |

### Milestones

Large features spanning multiple sprints get a **Milestone** as an umbrella. Each phase is a Milestone (e.g.,
Phase 10, Phase 11, Phase 12, Phase 14), and features large enough to span many issues but not tied to a
numbered phase get their own named Milestone (e.g., "Avatares para Alunos"). All related issues should be
assigned to their Milestone.

### Sub-issues

When an issue is described simply but requires many sprints to implement, **split it into sub-issues** before starting work.

Pattern (followed by #42 and #69):

1. Identify the broad issue
2. Break it into atomic, independently shippable sub-issues
3. Each sub-issue gets its own number, clear description, and labels
4. Link them back to the parent issue
5. Assign all to the same Milestone

Examples:
- #42 (Level progression design) → split into #86, #88, #90, #91, #92, #93
- #69 (STT feasibility spike) → split into #78, #79, #81, #82, #83, #84, #85
- #198 (Gacha ticket system) → split into #207, #208, #209, #210
- #197 (Teacher tab action row + gift coins) → split into #211, #212
- #441 (Full cinematic Gacha reveal) → #442 (versão provisória, implementada e fechada) + #441 mantida como needs-spec para a versão completa futura — padrão útil quando a versão final precisa de mais especificação mas uma versão funcional pode ser entregue antes

## Branching

Currently committing directly to `main`. When the project grows, switch to feature branches with PRs referencing the issue number.

## Documentation

All changes must be well-documented so that in the future it's easy to:
- Find opportunities for improvement
- Identify cost reduction opportunities
- Understand UX decisions and their rationale

Document:
- **Why** a decision was made (not just what changed)
- **Lessons learned** from bugs and hotfixes
- **Test results** (post as comments on the relevant issue)
- **Environment details** (browser, OS, PWA mode) for cross-browser testing

## Architecture Decision Records (ADRs)

Decisões técnicas relevantes são registradas em **`docs/decisions.md`** como ADRs numeradas sequencialmente (ADR-001, ADR-002, …).

### O que é uma ADR

Uma ADR documenta **uma decisão técnica específica**: o que foi decidido, por que, e quais são as consequências. O objetivo é que qualquer pessoa (ou o Claude numa sessão futura) possa entender o raciocínio sem precisar reler o histórico de conversas ou commits.

### Quando criar uma ADR

Crie uma ADR sempre que uma decisão:
- Tiver **alternativas reais** que foram consideradas e descartadas
- Criar uma **restrição duradoura** que vai impactar decisões futuras
- For **não óbvia** — alguém poderia razoavelmente questionar a escolha
- Envolver um **trade-off** entre performance, custo, UX, ou manutenibilidade

Não precisa de ADR: correções de bug simples, mudanças de copy, ajustes de CSS sem impacto arquitetural.

### Formato

Adicione ao final de `docs/decisions.md`:

```markdown
## ADR-NNN: <título curto>

**Date:** YYYY-MM-DD  
**Issues:** #NN

### Decision
O que foi decidido, em uma ou duas frases diretas.

### Rationale
Por que esta opção foi escolhida. Mencione alternativas descartadas se relevante.

### Consequences
O que muda, o que fica restrito, o que precisa de atenção no futuro.
```

### Referência no CHANGELOG e nos commits

Ao registrar a feature no CHANGELOG, adicione `(ADR-NNN)` ao lado da entrada relevante. Nos commits, não é obrigatório referenciar a ADR — o CHANGELOG é suficiente.

Exemplos já registrados: ADR-008 (limite de tokens por nível), ADR-011 (modelo de raridade dos avatares), ADR-018 (calligrafia mobile-only), ADR-024 (flag `noSuspense` para coins não-gacha).

## Cloudflare Functions

Functions live in `functions/api/`. Each function should have a header comment explaining:
- What it does
- Required environment variables
- Request/response format

See `functions/api/ai-enrich.js` for the reference format.

## Testing

For cross-browser STT testing, use the `/stt-test.html` page and submit results to the corresponding sub-issue via the auto-submit feature.

Manual testing results (JSON, screenshots, observations) should be posted as comments on the relevant issue.
