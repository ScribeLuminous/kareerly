# Authentication configuration

Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` from the Supabase project containing your existing accounts.
Use a public publishable/anon key, never a service-role key. Set these variables in
frontend hosting as well; restart or rebuild/redeploy after any change because Vite
embeds them at build time. Startup/build now rejects missing configuration.

## Sign-in connectivity incident (2026-09-11)

Login calls Supabase directly, not FastAPI. The previously hardcoded project hostname
`dgnxigotdpqiwohocloi.supabase.co` failed DNS resolution while `supabase.com` was
reachable. This prevents credentials from being checked.

Check the project in the Supabase dashboard and restore it if paused. If its URL
changed, update frontend and backend Supabase settings to the project holding the
existing accounts and redeploy. Check `/auth/v1/token` in browser Network tools and
verify an existing account can log in after recovery. Changing passwords or switching
account types does not repair DNS failures.

Run authentication regression checks with `node --test tests/auth.test.mjs`.

# UI system

- Colours: `tailwind.config.js` is the only palette definition; it also exposes each colour as a CSS variable (`--rust`, `--soft-text`, …). Use `soft-text` for small secondary text (`soft` is for icons and borders only).
- Primitives: `src/styles/ui.css` (mobile-first classes prefixed `k-`) and `src/components/ui/` (Modal/ConfirmDialog, FilterPanel, Tabs, Segmented, SearchField, InfoTip, Menu, Banner, EmptyState, SkeletonRows, ToastRegion).
- Candidate workspace: `src/pages/Dashboard.tsx` holds state and data flow; pages, the shell and job components are in `src/pages/candidate/`. Each page has a URL (`src/pages/candidate/routes.ts`).
- Breakpoints: Tailwind's `sm` 640, `md` 768 (icon rail), `lg` 1024 (sidebar and list + detail split views), `xl` 1280.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
