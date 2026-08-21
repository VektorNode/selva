# Commercial Services & Sponsorship

Selva is MIT-licensed and developed by [VektorNode AG](https://github.com/VektorNode), a Swiss
company. This page describes the paid services available around it, and how organisations fund
its development.

**Selva is MIT and stays MIT.** Commercial agreements fund development; they do not buy
exclusivity, and they do not create a closed edition. Everything paid work produces is released
under the same licence as the rest of the project. If you are evaluating Selva, nothing on this
page is something you need to buy — the whole system is free to self-host, and the documentation
is written to make that possible without us.

## Why this page exists

Selva is used to run parametric definitions in production, where a firm's geometry, its methods,
and its clients' data stay on the firm's own infrastructure. That is the reason most teams choose
it, and it is work that has to be maintained properly: security fixes, Rhino version tracking,
provider compatibility, and a stable schema contract between the plugin and the web app.

Paid engagements are what fund that maintenance. They are the alternative to venture capital and
to a closed-core licence — both of which would change what Selva is.

## Services

### Deployment and integration

We set Selva up on your infrastructure and hand it over working: Rhino.Compute provisioning,
reverse proxy and TLS, the auth provider your organisation already uses (Microsoft Entra via
forward-auth, Supabase, or the built-in local provider), storage, and backups.

Appropriate when you want the self-hosted deployment without spending your own engineers' weeks on
it, or when your IT department needs someone accountable for the architecture review.

The [self-hosting documentation](./docs/self-hosting/get-started/overview.md) covers the same
ground and is deliberately complete. Many teams need nothing beyond it.

### Funded feature development

You fund a feature; we build it and ship it in a release. The result is MIT-licensed like the rest
of the project.

This is the most direct way to influence the roadmap. It suits organisations that need a specific
capability — a provider for an internal identity system, an export format, a component for a
particular workflow — on a schedule rather than whenever it reaches the top of the backlog.

Two conditions keep this honest, and we apply them consistently:

- **The feature has to fit the project.** We will decline work that would make Selva worse for
  everyone else, and say so early rather than take the engagement and produce something awkward.
- **It ships publicly.** If you need something proprietary, the right answer is to build it on top
  of the `@selvajs/*` packages — the [provider interfaces](./packages/platform/README.md) exist
  precisely so you can, without forking.

### Training and workshops

Sessions for teams adopting Selva: designing schemas that survive contact with real users,
structuring definitions for server-side solving, the plugin's component set, and operating a
deployment.

Delivered remotely or on site. Scoped per engagement — a half-day introduction and a multi-day
workshop for a computational design group are different things.

## Sponsorship

Organisations that depend on Selva can fund its continued development directly, without a specific
deliverable attached. Sponsors are acknowledged in the repository and on the project website.

Sponsorship buys development time and the continuity that comes with it. To be explicit about what
it does **not** buy: it confers no control over the roadmap, no privileged support channel, and no
influence over technical decisions. Those are kept separate on purpose — a project that quietly
prioritises by who paid is not one you should trust with your infrastructure.

## What we do not offer

Being clear about the boundary is more useful than an open-ended promise:

- **No SLA-backed production support contracts.** Selva is maintained by a small team, and a
  response-time guarantee we cannot honour at 02:00 is worth nothing. Bugs are triaged publicly on
  the [issue tracker](https://github.com/VektorNode/selva/issues); security reports follow
  [SECURITY.md](./SECURITY.md) and are handled promptly.
- **No proprietary licence or closed edition.** There is no version of Selva with more features
  than the one in this repository.
- **No hosted service.** Selva is self-hosted by design; that is the point of it. We can deploy it
  for you, but we do not run it for you.

## Grants and research

Selva is a fit for public and foundation funding of open-source infrastructure, and for applied
research collaborations with academic partners in computational design and digital fabrication.

If you work in that area — a research group, a funding body, or a firm looking for an industry
partner on a joint proposal — we would be glad to talk.

## Contact

**hello@vektornode.com**

Useful things to include: what you are building, whether you intend to self-host, which auth
provider your organisation uses, and any deadline you are working to.

For everything else, please use the normal channels — [issues and
discussions](./SUPPORT.md) for questions and bugs, [SECURITY.md](./SECURITY.md) for
vulnerabilities, and [conduct@vektornode.com](mailto:conduct@vektornode.com) for Code of Conduct
matters.
