# Bootstrap prompt for the next session

> Copy the block below into the new Claude Code session as your first message. It primes the agent with everything it needs to resume the UX uniformity initiative without losing context.

---

## How to use

1. Open a new Claude Code session in `s:/Git Hub Repo Manager`.
2. Paste the entire fenced block below as your first message.
3. The agent will read the canonical handoff doc, summarise the state back to you, and ask which priority to pick first.

---

## The prompt

````
Estás a continuar uma iniciativa de UX uniformity (5 slices) que ficou na maior parte mergida no main na sessão anterior. **Não tentes adivinhar o estado actual** — começa por ler estes 2 ficheiros, por esta ordem:

1. `docs/specs/2026-05-01-handoff-next-session.md` — fonte de verdade canonical do estado e do que falta. Lê **todas as 8 secções**.
2. `docs/specs/2026-05-01-next-session-bootstrap-prompt.md` — este ficheiro (a "como usar" só, dispensa secções repetidas com o handoff).

Depois de leres os 2, executa estes 3 comandos para validar que o estado real bate com o handoff:

```bash
git log --oneline -10
git status --short
gh pr list --state open
```

Se houver divergência entre handoff e estado real, **confia no estado real** e actualiza o handoff doc como primeira acção.

---

## Regras absolutas (não negociáveis)

1. **NUNCA `Co-Authored-By` em commit messages.** Conventional Commits format only.
2. **NUNCA force-push para `main`.** Branch protection bloqueia mesmo com `--admin`. Se precisares reescrever história, faz no feature branch e re-PR.
3. **`git reset --hard` apaga ficheiros untracked.** Sempre `git status --short` antes; commit ou stash com `-u` antes de reset.
4. **`git stash pop` STAGEA todos os ficheiros restaurados.** Se queres add seletivo depois, primeiro `git restore --staged .`.
5. **TDD por tarefa:** falha o teste → run red → implementa → run green → commit → push. Cada tarefa = 1 commit; não acumular.
6. **No `Co-Authored-By`. No emojis em ficheiros (a não ser que o user peça).**
7. **`.jsx` only** (sem TypeScript). Tailwind utility classes. `ds-*` prefix para design-system classes. Read files antes de Edit (a tool obriga).
8. **Tests under `tests/`** mirroring `src/`. Server tests under `server/__tests__/`. Vitest unit/component, Playwright e2e.
9. **Memória do agent é persistente** em `C:\Users\bruno\.claude\projects\s--Git-Hub-Repo-Manager\memory\`. Lê os pointers listados na §7 do handoff doc.

---

## Como escolher o que fazer

A **§4 do handoff doc** tem o todo list ordenado por prioridade já. O bullet em "Priority 1" é sempre o próximo passo certo. Pega no primeiro item, faz, push, marca done no handoff, próximo.

Se o item for grande (mais de 1 ficheiro com lógica nova), usa `superpowers:subagent-driven-development` skill para o flow Implementer → Spec Review → Code Quality Review (já está documentado na sessão anterior).

Se for pequeno (single-file fix, lint regression, doc update), faz inline.

---

## Quando o contexto começar a apertar

Não tentes acabar tarefas a meio:

1. Commit incremental: `wip(<scope>): partial <task> — [estado concreto]`
2. Push o WIP commit
3. Adiciona uma linha à §4 do handoff doc descrevendo onde paraste
4. Para. A próxima sessão pega aqui.

Um WIP commit honesto é sempre melhor que "vou só terminar isto" que rebenta a meio.

---

## Validação obrigatória depois de qualquer mudança em código

```bash
# Para foundation/registry/lint changes:
npx vitest run tests/actions tests/components/RepoList tests/components/ui/ContextMenu.test.jsx tests/components/RepoContextMenu.test.jsx tests/utils/repoMutations.test.js tests/lint/no-bare-destructive-buttons.test.js

# Para Community Health changes:
npx vitest run server/__tests__/community-health-fix.test.js tests/utils/aiErrorFriendly.test.js

# Para mobile changes:
npx vitest run tests/components/ui/MobileFAB.test.jsx tests/components/ui/ModalSticky.test.jsx tests/hooks/useViewportSafeHeight.test.js

# Antes de qualquer push:
npx vitest run                      # full suite
npm run build                       # bundle still builds
```

Threshold de aceitação: full suite **3002+ passing** (1 fail é o `no-standalone-loader2` pre-existente listado na §5 do handoff). Qualquer fail novo = blocker, investiga antes de push.

---

## Bias para a acção, não para a deliberação

Esta iniciativa está 80% feita. O que falta é **trabalho mecânico bem definido** — não há mais brainstorming necessário (excepto slice 3 part 2 que está marcado explicitamente como "needs brainstorming first" na §4).

Para tudo o resto: lê o spec/plan, segue os steps, valida, commit, push. As specs já têm code blocks completos para a maioria das tasks. Confia neles; aplica.

A primeira mensagem que me devolves deve ser o teu plano para o **próximo commit** baseado na priority 1 do handoff. Não me peças confirmação para escolhas que estão claras na §4 — anda.
````

---

## Notas para o utilizador (não cole isto)

- **Onde encontrar o handoff:** `s:/Git Hub Repo Manager/docs/specs/2026-05-01-handoff-next-session.md`
- **Onde está a memória do agent:** `C:\Users\bruno\.claude\projects\s--Git-Hub-Repo-Manager\memory\`
- **Slice 1, 2, 4, 5 já estão merged em main.** Se houver dúvidas, vê PRs #28, #29, #30, #31 no GitHub.
- **PR #27** foi closed (superseded por #31). Não tentes reabrir.
- **WIP do utilizador** (16 ficheiros novos + 20 modificados) já está integrado em main via commits `60e52f9` + `93fbe1f`. Se a próxima sessão precisar de fazer outra integração de WIP, segue o protocolo da §6 do handoff doc.

Última coisa: se a nova sessão começar e a primeira coisa que ela fizer for "vou ler o handoff" — está bom, é exactamente isso que ela deve fazer. Se em vez disso ela tentar começar a implementar sem ler nada, **diz-lhe para parar e ler o handoff primeiro**. É o ponto crítico da bootstrap.
