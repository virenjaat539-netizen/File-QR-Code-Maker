# File QR Maker

File QR Maker turns an uploaded image or file into a shareable public link and downloadable QR code.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/file-qr-maker/src/App.tsx` — upload, direct-to-storage flow, QR generation, and result UI
- `artifacts/file-qr-maker/src/index.css` — Scanlight visual theme and motion
- `artifacts/api-server/src/routes/storage.ts` — signed upload URL and object serving routes
- `lib/api-spec/openapi.yaml` — upload URL API contract

## Architecture decisions

- File bytes upload directly to App Storage through a short-lived signed PUT URL; the API does not proxy file contents.
- QR codes point to the app's `/api/storage/objects/...` URL so scans open the original file on any device.
- Uploads are intentionally frictionless and do not require an account for this first version.

## Product

Users can drag and drop or select any non-empty file, see an image preview when applicable, upload it securely, generate a QR code, copy the share link, download the QR image, and start over.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run API codegen after changing `lib/api-spec/openapi.yaml`.
- The web build needs `PORT` and `BASE_PATH` supplied by its managed workflow.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
