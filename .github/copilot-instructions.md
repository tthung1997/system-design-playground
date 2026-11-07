# Copilot instructions

## Git commits and pushes

GitHub email privacy is enabled for this account. Pushes are rejected (`push declined due to email privacy restrictions`) if a commit is authored or committed with a private email address.

Before the first commit in a clone or worktree, set the noreply identity for this repository:

```bash
git config user.email "19512458+tthung1997@users.noreply.github.com"
```

If a push was already rejected, rewrite the unpushed commits with the correct author and push again (replace `<base>` with the commit the branch started from, e.g. `origin/main`):

```bash
git rebase <base> --exec 'git commit --amend --no-edit --reset-author -q'
```

Keep the `Co-authored-by` trailer on commits made by the Copilot app.

## Project commands

```bash
npm ci             # install dependencies (worktrees start without node_modules)
npm run dev        # dev server
npm test           # vitest
npm run typecheck  # tsc -b
npm run build      # typecheck + production build
```

## UI conventions

- Styling uses Tailwind v4. Colors come from CSS variables in `src/index.css` (light/dark themes); use semantic utilities such as `bg-panel`, `border-line`, `text-muted` instead of per-theme `dark:` variants.
- Component icons and per-kind colors live in `src/ui/icons.tsx` (`KIND_STYLES`); add new component kinds there and in `src/model/defaults.ts` (including `CONFIG_FIELDS`) and `src/simulation/catalog.ts`.
- Simulator capacities, costs and formulas live in `src/simulation/catalog.ts` and `simulate.ts`. Bump `SIM_VERSION` (or a challenge's `version`) when results change, so old submissions are never ranked against new rules.
- Keep the animated traffic edges; do not disable them for `prefers-reduced-motion`.
