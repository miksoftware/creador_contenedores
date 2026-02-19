# Tech Stack

## Framework & Runtime

- Next.js 16.x (App Router)
- React 19.x
- TypeScript 5.x (strict mode)

## Styling

- Tailwind CSS 4.x with PostCSS
- CSS variables for theming (dark mode default)
- Custom utility classes: `glass-panel`, `input-glass`, `btn-primary`, `gradient-text`

## Key Libraries

- `framer-motion` - Animations and transitions
- `lucide-react` - Icon components
- `ssh2` - SSH client for remote server execution
- `clsx` + `tailwind-merge` - Conditional class utilities

## Build Configuration

- ESLint with Next.js core-web-vitals and TypeScript rules
- TypeScript and ESLint errors ignored during builds (see `next.config.ts`)
- `ssh2` marked as server external package

## Common Commands

```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Path Aliases

- `@/*` maps to project root (e.g., `@/lib/utils`, `@/components/...`)
