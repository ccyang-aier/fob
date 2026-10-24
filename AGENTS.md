# Fob

Fob (Fusion One Book) is the independent, Web-only knowledge product copied from Fouc. The authoritative architecture is `docs/architecture/fob-product-boundaries.md`; execution status is `.spec/tasks/fob-extraction.md`.

## Product and engineering boundaries

- Use Next.js App Router, React, TypeScript, Tailwind CSS v4, existing Radix-style components, the TypeScript/Bun business service, and PostgreSQL. Keep backend APIs Node-compatible. Retain the independent Python media worker.
- This product has no Tauri application, desktop sidecar, native IPC, or runtime dependency on the sibling Fouc checkout.
- Copy existing implementations and make the smallest required Web/branding adaptations. Preserve the editor, collaboration, permissions, search, AI, MCP, import/export, files, and local-browser knowledge capabilities.
- `src/` owns frontend behavior; `backend/server/` owns identity, projects, knowledge and models; `shared/` owns pure contracts/document semantics. Frontend server imports are type-only through `@fob/server/knowledge-api`.
- Project switching, project members, and the knowledge-base open-project model are copied as implemented. Do not introduce a second workspace entity or `workspaceId`. Fob projects and knowledge bases are independent resources with their existing ACLs.
- Fob owns its database, object-storage namespace, account/session/token state, deployment, and browser-storage keys. Never silently connect to Fouc endpoints, read Fouc secrets, or mutate Fouc data.
- Work only in this checkout. Do not modify `../fouc`, its running services, database, or local settings.
- Source availability is not acceptance evidence. Keep unavailable externally configured capabilities explicit.

## Workflow

- Read `AI_FRONTEND_RULES.md` before frontend work and before committing; preserve the copied layout, interaction states and icon conventions.
- Read relevant guides in `node_modules/next/dist/docs/` before changing Next.js behavior.
- Maintain one current design document per topic in `docs/`; maintain execution gates and validation evidence in `.spec/tasks/`.
- Independent agents may work in disjoint file ranges; the primary agent owns integration, authoritative docs and commits.
- Keep the Web/service development processes running during development. Validate modified behavior, P0 resource boundaries and a real visual flow; do not build desktop binaries.
- Commit completed and validated work with a clear conventional commit message. Never include credentials, runtime snapshots or transient screenshots.
- This is a new product without legacy production formats. Do not add compatibility schemas or fallback-to-Fouc branches. A deliberate one-time independent data copy is a transfer operation, not a legacy runtime path.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
