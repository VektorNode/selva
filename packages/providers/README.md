# Providers

Implementations of the `@selvajs/platform` provider interfaces (auth, data,
storage, permissions). The Selva app picks one at startup via its provider
config — see [packages/selva/.env.example](../selva/.env.example).

| Package                         | Backs onto                         | Use when                                         |
| ------------------------------- | ---------------------------------- | ------------------------------------------------ |
| [`local`](./local/)             | Filesystem (JSON + HMAC sessions)  | Single-machine deployments, no external services |
| [`supabase`](./supabase/)       | Supabase (Postgres + `auth.users`) | Hosted deployments with managed auth             |
| [`header-auth`](./header-auth/) | Reverse-proxy headers (e.g. Entra) | Auth handled upstream of Selva                   |

Each package's README covers its setup. To build a new one, start from
[writing-a-provider](../../docs/self-hosting/providers/writing-a-provider.md).
