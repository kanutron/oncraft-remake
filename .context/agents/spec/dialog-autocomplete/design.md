# Dialog Autocomplete & Smart Fields

> Improve Add Repository and New Session dialogs with autocomplete, path memory, and branch suggestions.

## Approach

Composables-first: two data-fetching composables (`usePathSuggestions`, `useBranchSuggestions`) paired with NuxtUI's `UInputMenu` component used directly in the dialogs. No wrapper components.

## Backend: Filesystem API

### New endpoint

`GET /filesystem/list-dirs?path=<absolute-path>`

Scoped to `ONCRAFT_FS_ROOT` env var (default: `~` resolved to absolute). Rejects paths outside the root with `403`.

**Response:**

```ts
{
  entries: Array<{
    name: string       // directory name
    path: string       // absolute path
    isGitRepo: boolean // has .git/ inside
  }>
  parent: string | null  // parent directory path, null if at root
}
```

- Returns directories only (no files)
- Sorted alphabetically
- Hidden directories (`.` prefix) excluded
- Git detection via `fs.existsSync(entry/.git/)`
- Returns `404` if path doesn't exist or isn't a directory

**Files:**

- `packages/backend/src/routes/filesystem.routes.ts` — route registration
- `packages/backend/src/services/filesystem.service.ts` — directory listing and git detection logic

## Frontend: `usePathSuggestions` composable

**File:** `packages/frontend/app/composables/usePathSuggestions.ts`

Watches the current path input value. On change (debounced ~200ms), extracts the parent directory and calls the filesystem API. Filters entries client-side by the partial segment the user is typing.

```ts
const {
  items,       // Ref<InputMenuItem[]> — filtered directory suggestions
  loading,     // Ref<boolean>
  isGitRepo,   // Ref<boolean> — whether current path is a git repo
  lastParent,  // Ref<string> — last-used parent from localStorage
} = usePathSuggestions(pathValue: Ref<string>)
```

**Items** use `i-simple-icons-git` icon for git repos, `i-lucide-folder` otherwise.

**Last used path:** On successful repo creation, stores the parent directory in localStorage (`oncraft:lastRepoParent`). On dialog open, pre-fills the input with this value to trigger initial suggestions. On first use (no stored value), the field starts empty.

**`isGitRepo`:** Derived from the current listing — `true` when the last segment of the typed path matches an entry in the parent's listing that has `isGitRepo: true`. Drives the dynamic icon on the input field.

Errors (404 for invalid paths) are silently swallowed — suggestions list stays empty.

## Frontend: `useBranchSuggestions` composable

**File:** `packages/frontend/app/composables/useBranchSuggestions.ts`

Fetches branches once from `GET /repositories/:id/git/branches` when initialized. Re-fetches if `repositoryId` changes. No debouncing — branch lists are small enough for client-side filtering.

```ts
const {
  items,    // Ref<InputMenuItem[]> — all branches
  loading,  // Ref<boolean>
  refresh,  // () => Promise<void> — manual re-fetch
} = useBranchSuggestions(repositoryId: Ref<string>)
```

Current/HEAD branch is visually distinguished in items (chip or trailing text).

## Frontend: Add Repository dialog changes

**File:** `packages/frontend/app/components/repository/RepositorySelector.vue`

**Path field** — `UInput` replaced with `UInputMenu` in `autocomplete` mode:

- Wired to `usePathSuggestions(path)` for `items` and `loading`
- `ignoreFilter` set (composable handles filtering)
- `icon` bound dynamically: git icon when `isGitRepo` is true, folder icon otherwise
- Pre-fills with `lastParent` on dialog open

**Name field** — stays as `UInput` with auto-fill:

- Watches `path` value, sets name to last path segment when name is empty or was auto-filled
- Tracks `nameManuallyEdited` flag to stop overwriting user edits

Both render modes (modal and inline empty-state) share the same field refs and get the upgrade automatically.

## Frontend: New Session dialog changes

**File:** `packages/frontend/app/components/session/NewSessionDialog.vue`

All three branch fields replace `UInput` with `UInputMenu`. A single `useBranchSuggestions(repositoryId)` instance is shared across all three.

| Field | Mode | UInputMenu config |
|-------|------|-------------------|
| Source branch | strict | Plain — no `createItem`, no `autocomplete` |
| Target branch | free | `createItem` enabled |
| Work branch | free | `createItem` enabled |

- Source branch defaults to HEAD branch (pre-selected)
- Target branch placeholder: "defaults to source branch"
- Work branch visibility unchanged (only when `workIsolated` is on)
- New branch names show "Create ..." option via `UInputMenu`'s built-in `createItem` behavior

No changes to name field, `workIsolated` toggle, validation, or submission flow.

## Out of scope

- **Fuzzy path expansion** (zsh-style `/u/l/b` → `/usr/local/bin`) — interesting but deferred to a future iteration.
- **File browsing** — endpoint returns directories only; no file picker use case yet.
- **Remote filesystem** — this is a local-only tool; no network filesystem support.
