# MAFIA: BETRAYAL

A Telegram social-deduction game set in the fictional city of **الغُراب**.

## Stack

- Cloudflare Workers: Telegram webhook and HTTP entry point
- Cloudflare D1: durable relational records
- Cloudflare Durable Objects: one serialized game coordinator per room
- JavaScript ES modules; Node.js built-in test runner

## Status

Foundation in progress. The core domain engine and tests are being added. No Telegram token or Cloudflare secret belongs in source control.

## Local development

```sh
npm install
npm test
npm run check
```

Copy `.dev.vars.example` to `.dev.vars` and fill in local values before running the Worker. Never commit `.dev.vars`.

## Deployment

Create the D1 database and configure its ID in `wrangler.toml`, then apply migrations and set Worker secrets using Wrangler. See the deployment section below once the first playable flow is complete.
