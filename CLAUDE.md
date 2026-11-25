# [YOUR BRAND] — AI Agent Instructions

> Read `docs/BRIEF.md` first. It is the canonical project brief and design rules.
> This file is a quick-start for AI sessions.

## Quick orientation

- **Monorepo root** — `pnpm + Turborepo`. Run `pnpm build` from root to build all apps.
- **Storefront** — `apps/web` (Next.js 16 App Router, React 19, TypeScript strict).
- **Admin** — `apps/admin` (placeholder until Phase 9).
- **API** — `apps/api` (NestJS, PostgreSQL/Prisma, Redis/BullMQ).
- **Shared types** — `packages/shared` (Zod schemas, enums, TypeScript types).

## Key files

| File                               | Purpose                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| `docs/BRIEF.md`                    | Full project brief, data model, design rules, phase plan         |
| `docs/OWNER_TODO.md`               | Running list of items needing real data from the owner           |
| `apps/web/lib/tokens.ts`           | Design tokens (colours, fonts, motion) — single source of truth  |
| `apps/web/app/globals.css`         | Tailwind v4 `@theme inline` block — mirrors tokens.ts            |
| `apps/web/app/styleguide/page.tsx` | Hidden `/styleguide` page — visual reference for all tokens      |
| `apps/web/lib/products.ts`         | PLACEHOLDER product data (removed in Phase 3, replaced by API)   |
| `apps/web/lib/content.ts`          | PLACEHOLDER site content (FAQ, process steps, trust cards, etc.) |

## Rules for every change

1. **Read `docs/BRIEF.md` before writing any code.**
2. **Design:** Only use existing colour tokens and fonts. Reuse existing components.
3. **Money:** Always paise (integer). Never floats. Always server-side calculations.
4. **Tests:** Every money and stock path needs tests before a phase is done.
5. **Placeholders:** Use `TODO(owner):` comments. Add to `docs/OWNER_TODO.md`.
6. **Commits:** Conventional commits (`feat:`, `fix:`, `chore:`, etc.). Keep them small.
7. **Phase gate:** Stop and summarise after each phase. Wait for "go" before the next.

## Commands

```bash
pnpm install          # install all workspace dependencies
pnpm build            # build all apps (turbo)
pnpm dev              # start all apps in dev mode (turbo, parallel)
pnpm lint             # lint all apps
pnpm typecheck        # type-check all apps
pnpm test             # run all tests
pnpm format           # format all files
```

Individual apps:

```bash
cd apps/web && pnpm dev      # storefront on :3000
cd apps/admin && pnpm dev    # admin on :3001
cd apps/api && pnpm dev      # API on :4000
```
