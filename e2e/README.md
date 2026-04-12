# E2E Tests

End-to-end tests using Playwright, covering core user flows:

1. Authentication (sign up / sign in)
2. Project creation from template
3. AI conversation (send message, receive response)
4. File preview (dev server + HMR)
5. Version creation and publishing
6. Deployment
7. Version rollback

## Setup

```bash
pnpm add -D @playwright/test
npx playwright install
```

## Running

```bash
# Start the dev environment first
pnpm dev

# Run E2E tests
npx playwright test
```

## Structure

```
e2e/
├── README.md
├── playwright.config.ts   # (to be added)
├── tests/
│   ├── auth.spec.ts
│   ├── project.spec.ts
│   ├── conversation.spec.ts
│   ├── preview.spec.ts
│   ├── deploy.spec.ts
│   └── rollback.spec.ts
└── fixtures/
    └── test-data.ts
```

E2E tests require the full stack running (web + control-worker + agent-worker + PostgreSQL + Redis).
