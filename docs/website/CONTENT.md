# Selva Website — Content Specification

> Single-page marketing site for Selva. Stealth phase: real domain, real content, shared privately with design partners and grant reviewers. No public launch yet.

This is the source of truth for what goes on selva.dev (or whichever domain). Build the site from this. Update this file when copy changes, not the live site directly.

## Audience & purpose

Three readers, in priority order:

1. **Head of computational design at an AEC firm** (Herzog & de Meuron, Foster+Partners, BIG, Bollinger+Grohmann). Pragmatic. Already knows ShapeDiver and Hops. Wants to know: what does this do that I can't already do, and can I trust it in production?
2. **Fabrication / configurator buyer** (Design-to-Production, Blumer Lehmann, façade fabricators). Needs to expose parametric definitions to clients/sales without per-seat licenses or sending IP to a third party.
3. **Grant reviewer** (Innosuisse, NLnet, Hasler). Not a Grasshopper user. Needs to understand the problem, the solution, the open-source/digital-sovereignty angle, and that this is real engineering — not a hobby project.

The site must work for all three without separate pages. The hero serves all three; the deeper sections serve the technical audience.

## Voice & tone

- Direct. No marketing fluff. No exclamation marks. No "revolutionize," "empower," "unleash."
- Specific. Name the technologies (Grasshopper, Rhino.Compute, Three.js, SvelteKit). Concrete numbers where possible.
- Honest about scope. State what Selva is *not* (not a SaaS, not a designer tool, not a Grasshopper replacement).
- Confident, not defensive. Don't apologize for being open source.
- One idea per sentence. Short paragraphs.

Reference: Tailscale, Plausible, and Linear websites for tone. Avoid the Vercel/Netlify-style "magic" framing.

## Site structure — one scrollable page

Sections in order. Each section has a one-line goal, the copy, and notes on visuals.

---

## Section 1 — Hero

**Goal:** Reader understands what Selva is and decides to keep scrolling in under 5 seconds.

### Eyebrow
`OPEN SOURCE · MIT · SELF-HOSTABLE`

### Headline (H1)
**Turn Grasshopper definitions into web apps.**

### Subheadline
The open-source way to ship parametric design tools to the browser — running on your own infrastructure, with no per-seat licensing and no third party touching your geometry.

### Primary CTA
`Try the live demo →` (links to a public hosted instance of compute-app with a sample definition)

### Secondary CTA
`View on GitHub` (links to repo once public; placeholder for now)

### Tertiary
Small text underneath: `Built for Rhino 7 and Rhino 8. Works with self-hosted Rhino.Compute.`

### Visuals
- **Hero asset (the single most important thing on the site):** 60–90 second muted, looping video. Shows: (a) Grasshopper canvas with the UIBuilder component, (b) the builder-app schema designer with drag-drop, (c) the compute-app running in a browser solving the definition, (d) the 3D viewer rotating. No voiceover, just clean cuts. Captions optional.
- **Fallback for slow connections:** a single composite screenshot showing all three surfaces side by side (GH canvas + builder + browser app).

### Notes
- Don't say "powerful," "modern," or "next-generation." These are filler.
- Don't lead with the open-source angle in the headline — lead with what it does. OSS is the eyebrow.
- Avoid jargon in the H1. "Parametric design tools" is fine in the subheadline; "Grasshopper definitions" must appear in the H1 because that's the search term.

---

## Section 2 — The problem

**Goal:** Reader nods. "Yes, that's exactly the friction I have."

### Headline (H2)
**Grasshopper is powerful. Grasshopper is also stuck on the designer's machine.**

### Body
Computational design teams build extraordinary tools in Grasshopper — configurators, generators, optimization workflows, drawing automations. None of it leaves Rhino without significant engineering effort.

The existing options are:

- **Hosted SaaS** (ShapeDiver, others) — fast to set up, but your client geometry sits on someone else's servers, your customization is bounded by their UI primitives, and you pay per definition per month forever.
- **Roll your own** — full control, but you're now maintaining a Rhino.Compute deployment, a web app, a schema system, and a 3D viewer. That's a year of engineering before you ship anything.

Selva is the middle path: a maintained, open-source toolchain you self-host, with a real UI builder and a real runtime, and no recurring per-definition cost.

### Visuals
- Three-column diagram: `Grasshopper machine ❌` / `SaaS upload ⚠️` / `Self-hosted Selva ✅`. Keep it simple — boxes and arrows, not icons.

### Notes
- Name ShapeDiver. Don't dance around it. Reviewers and buyers will think it anyway; naming it shows you understand the market.
- Don't bash competitors. "Hosted SaaS" gets a fair description.
- The three-option framing is doing real work here — it's the comparison the buyer is already running in their head.

---

## Section 3 — How it works

**Goal:** Reader understands the system in 20 seconds. The three boxes are the mental model that should stick.

### Headline (H2)
**Three pieces. One toolchain.**

### Three columns, each with an icon, a title, a one-line description, and 2–3 bullet points.

#### Column 1 — Plugin (Grasshopper)
**You design in Grasshopper.**
The Selva plugin adds components that mark which inputs and outputs should be exposed to the web. You stay in your existing modeling workflow.

- One `.gha` file, works in Rhino 7 and 8
- Drop in `UIBuilder`, `ThreeMaterial`, `BlockToFile`, `DataToFile` components
- Live WebSocket connection to the schema designer during development

#### Column 2 — Builder (Designer)
**You build the UI by dragging.**
A schema designer maps your Grasshopper inputs to web controls — sliders, dropdowns, color pickers, file uploads — without writing code.

- Drag-and-drop schema editor
- Live preview connected to your running Rhino instance
- Single schema generates both TypeScript and C# types

#### Column 3 — Compute (Runtime)
**You ship a standalone web app.**
The compute-app solves your definition through Rhino.Compute and renders geometry in the browser. Deploy it to your own server.

- Single SvelteKit app, deployed anywhere Node.js runs
- Local-filesystem or Supabase backend, your choice
- 3D viewer powered by Three.js, no plugin install for end users

### Visuals
- Three matched cards. Each gets a small isometric or line-art illustration. If illustrations aren't ready, screenshots of each surface are fine — sometimes better.
- Don't use stock illustrations. They tank credibility.

### Notes
- The mental model is `design → build → deploy`. Keep that left-to-right flow.
- Avoid the word "seamless." Engineers immediately distrust it.

---

## Section 4 — Use cases

**Goal:** Reader sees their own workflow in at least one of three cards.

### Headline (H2)
**Built for the things teams already use Grasshopper for.**

### Three cards. Each: tag, title, 2–3 sentences, screenshot, optional case-study link.

#### Card 1 — `CONFIGURATOR`
**Customer-facing product configurators**
Expose a parametric model to clients or sales teams. They adjust parameters, see real-time geometry, export a result — without ever touching Rhino. Common for furniture, façades, modular construction, custom fabrication.

#### Card 2 — `INTERNAL TOOL`
**Internal tools for design teams**
Wrap a complex definition so non-Grasshopper colleagues — architects, engineers, project managers — can run it themselves. Replaces "can you re-run this with these numbers?" Slack messages.

#### Card 3 — `CLIENT VIEWER`
**Client-facing presentation tools**
Send a link instead of a screenshot. Clients explore options live in the browser, with the parameters you decide to expose. Geometry stays on your infrastructure.

### Visuals
- One real screenshot per card. If you only have placeholder definitions, build three obviously different ones (a chair configurator, a structural sizing tool, a façade panel explorer) so the cards don't look identical.
- Each card optionally links to a longer case study page — for v1, leave the links unwired or pointing to a "case studies coming soon" anchor.

### Notes
- Pick three that visually look different — same definition with different parameters looks lazy.
- For the academic/grant reader, the configurator use case is the strongest because it's commercially obvious.

---

## Section 5 — Architecture & self-hosting

**Goal:** Technical reader trusts that this is real engineering. Grant reviewer sees the digital-sovereignty angle clearly.

### Headline (H2)
**Your geometry. Your servers. Your data residency.**

### Body
Selva is architected so that no client data ever leaves infrastructure you control. The plugin runs in your Rhino. The compute-app runs on your server. The Rhino.Compute instance is yours. End users see geometry in their browser; nothing is uploaded to a third party.

For teams under GDPR, NDA-bound client work, or internal security review: the system has nothing for them to flag because there is no third party in the data path.

### Diagram

A clean architecture diagram showing the data path:

```
   [End user browser]   <— HTTPS —>   [Your compute-app server]
                                              │
                                              │ HTTP
                                              ▼
                                       [Your Rhino.Compute]
                                              │
                                              ▼
                                       [Your .gh definitions]
```

Annotation underneath: "No traffic leaves your network perimeter. Selva does not run a SaaS — there is no Selva server to send anything to."

### Sub-features (bullet list, not headlines)

- **Single `.gha` plugin file** — no external runtime dependencies; web assets embedded as resources
- **Multi-tenant if you want it** — organizations, projects, role-based permissions, share links with HMAC-hashed tokens at rest
- **Pluggable backends** — local filesystem (JSON + atomic writes) for single-tenant, Supabase for multi-tenant deployments
- **End-to-end type safety** — one JSON schema generates TypeScript and C# types, so the plugin and the web app cannot drift
- **MIT licensed** — fork it, audit it, run it forever

### Notes
- This section is where the grant reviewer should be convinced. Keep the technical specifics — they read as competence.
- Don't bury the GDPR line. It's a one-sentence trust signal that EU buyers actively look for.
- The diagram matters more than the words. A reader who only looks at the diagram should still get it.

---

## Section 6 — Comparison

**Goal:** Reader who's evaluating against ShapeDiver or building-in-house has a clean side-by-side.

### Headline (H2)
**Where Selva fits.**

### Table

| | **Selva** | **ShapeDiver** | **DIY (Rhino.Compute + custom web app)** |
|---|---|---|---|
| **Licensing** | MIT, open source | Commercial SaaS, per-definition tier | Your own license |
| **Hosting** | Self-hosted | Hosted by ShapeDiver | Self-hosted |
| **Client geometry leaves your network** | No | Yes | No |
| **Per-month cost per definition** | None | Yes | None (your hosting only) |
| **UI builder** | Drag-and-drop, included | Included | Build yourself |
| **3D viewer** | Three.js, included | Included | Build yourself |
| **Setup time** | Hours to days | Minutes | Months |
| **Vendor lock-in risk** | None (fork it) | High | None |
| **Source code access** | Full | None | You wrote it |
| **Best fit for** | Studios and fabricators with internal dev capacity, clients with data-residency requirements | Quick start, teams that prefer SaaS, low-volume use | Teams with unusual requirements and engineering time |

### Body underneath
ShapeDiver is the right choice for many teams — particularly if you want zero infrastructure and your client geometry isn't sensitive. Selva is the right choice when self-hosting matters: regulated industries, IP-sensitive fabrication, large-volume deployments where per-definition pricing stops making sense, or any team that wants to own and audit the toolchain end-to-end.

### Notes
- Be genuinely fair to ShapeDiver. Pretending a real, well-built competitor doesn't exist makes you look naive. Acknowledging where they win makes you look like an adult.
- "Best fit for" row is the most important — it tells each reader whether to keep reading or to leave (and that's fine; the readers who stay are the right readers).

---

## Section 7 — Who builds it / why

**Goal:** Reader trusts that this won't disappear in six months. Grant reviewer sees credibility.

### Headline (H2)
**Built by people who use it.**

### Body

Selva is developed by [VektorNode AG](#contact), an independent Swiss company. It powers production work for our own consultancy clients — that's where the requirements come from, and that's why it's open source: the tool is more valuable to everyone, including us, when the ecosystem around it is alive.

We also maintain [Selva Canopy](https://www.food4rhino.com/en/app/selva-canopy), a companion Grasshopper plugin available on Food4Rhino, and contribute to the [VektorNode fork of Rhino.Compute](https://github.com/VektorNode/compute.rhino3d) that adds block instance support.

### Sub-bullets

- **Sustainable funding:** corporate sponsorship and grants, not VC. We don't have a runway clock pushing us toward a feature freeze and a paywall.
- **Long-term commitment:** Selva is part of how we deliver client work. It cannot disappear without breaking our own deliveries.
- **Open governance:** MIT license, public roadmap, community contributions welcome.

### Notes
- The phrase "powers production work for our own consultancy clients" is doing heavy trust-building. Only keep it if true today; if it's aspirational, soften to "is built alongside production consultancy work."
- The "we don't have a runway clock" line is for grant reviewers and skeptical AEC procurement people. It's a real differentiator vs. VC-backed competitors.

---

## Section 8 — Support the project

**Goal:** Sponsor-curious reader has a clear next step.

### Headline (H2)
**Selva is open source. Sponsors keep it moving.**

### Body
If your team uses Selva or plans to, sponsoring is the most direct way to fund development, get priority support, and shape the roadmap. Sponsorship is not a license fee — the code stays free and MIT-licensed for everyone.

Tiers range from CHF 500/year (individual supporter) to CHF 75,000+/year (strategic partnership with reserved roadmap influence). Full breakdown in [SPONSORS.md](#sponsors-link).

### Two CTAs side by side
- `See sponsor tiers →` (links to SPONSORS.md or a /sponsors page)
- `Talk to us about a custom arrangement →` (mailto or contact form)

### Notes
- This section is short on purpose. The detail lives in SPONSORS.md. The website's job is to convert curious → click.
- Don't list tier amounts on the site itself. Keep them in the canonical SPONSORS.md so updates only happen in one place.

---

## Section 9 — FAQ

**Goal:** Pre-empt the five questions every reader has.

### Headline (H2)
**Common questions.**

### Q1 — Do my end users need Rhino installed?
No. End users only need a modern browser. The compute-app solves the definition server-side via Rhino.Compute and streams geometry to the browser as Three.js meshes.

### Q2 — Do I need to run my own Rhino.Compute?
Yes. Selva does not include a hosted compute service. You point Selva at a Rhino.Compute server you control. We recommend the [VektorNode fork](https://github.com/VektorNode/compute.rhino3d) for block instance support.

### Q3 — Can I use it commercially?
Yes. MIT license. No commercial restrictions, no royalties.

### Q4 — How does this compare to Hops?
Hops solves Grasshopper definitions through Rhino.Compute from within another Grasshopper definition — it's a Grasshopper-to-Grasshopper bridge. Selva exposes definitions to the *web*, so non-Grasshopper users can interact with them. Different problem, different audience.

### Q5 — Is this production-ready?
Selva is in active development and used in production by our own consultancy work. We recommend pinning to a release tag, running your own integration tests, and getting in touch if you're deploying at scale — that's exactly the kind of conversation sponsorship enables.

### Q6 — What about Rhino on Mac / Linux?
The plugin builds for net48 (Rhino 7) and net7.0 (Rhino 8) on Windows and Mac. The compute-app is a Node.js application and runs on Linux, Mac, and Windows. The Rhino.Compute server itself runs on Windows.

### Q7 — Can I contribute?
Yes — open issues, PRs, and discussions are welcome on GitHub. Larger changes should start with an issue so we can align on direction.

### Notes
- Order questions by how likely they are to block a decision. Q1 and Q2 are deal-breakers if unclear.
- Don't add questions you wish people were asking. Only add questions people actually ask.

---

## Section 10 — Footer

**Goal:** Wayfinding, contact, credibility markers.

### Three columns

#### Column 1 — Project
- GitHub
- Docs
- Sponsors
- Releases

#### Column 2 — Company
- About VektorNode AG
- Contact
- Imprint (required for Swiss commercial site)
- Privacy (required if any form collects data — keep it short and honest)

#### Column 3 — Ecosystem
- Rhino
- Grasshopper
- Rhino.Compute (VektorNode fork)
- Selva Canopy (Food4Rhino)

### Bottom row
- `MIT License`
- `© 2026 VektorNode AG, Switzerland`
- Small badges: `Built with SvelteKit · Hosted on Cloudflare`

### Notes
- Imprint (Impressum) is legally required for a Swiss commercial entity running a website. Don't skip it. One short page with company name, address, register number, contact email.

---

## What's deliberately NOT on the site (v1)

- **No team page.** Solo founder + AG. Don't fake a team.
- **No blog.** Until you have something to say. Adding "Coming soon" looks worse than not having it.
- **No pricing page for the product.** The product is free. Pricing belongs on the sponsor page.
- **No testimonials.** You don't have any yet. Fake or vague ones destroy trust.
- **No "trusted by" logo wall.** Same reason. Once you have 2–3 real ones, add it.
- **No newsletter signup.** Not until you have something to send.
- **No login / signup buttons.** That's the compute-app, not the marketing site.
- **No multi-language.** English only. Your target buyers all read English.
- **No animation libraries / scroll-triggered theatrics.** They slow the page, hurt accessibility, and signal "marketing site built by someone who doesn't trust their content."

## Stealth-phase specifics

- **Domain:** register `selva.dev` (first choice), `selva.studio`, or `getselva.com`
- **Access:** public HTML, but add `<meta name="robots" content="noindex,nofollow">` in `<head>` to prevent search indexing during stealth. Remove on public launch.
- **No social cards yet** — until the demo video is recorded. A bad OG image is worse than none.
- **GitHub link:** point to a placeholder anchor until the repo is public. Don't 404; route to a "GitHub access available on request" anchor or contact form.
- **Live demo link:** point to a public hosted compute-app instance with 1–2 well-curated sample definitions. This is the second-most-important asset after the hero video.

## Assets checklist

Before the site goes live (even stealthily):

- [ ] Domain registered
- [ ] Hero video (60–90s, muted, looping, no voiceover)
- [ ] Hero fallback composite screenshot
- [ ] Three "how it works" screenshots or illustrations (plugin / builder / compute)
- [ ] Three "use case" screenshots, visually distinct
- [ ] Architecture diagram (clean, ASCII-style or SVG)
- [ ] Comparison table content reviewed for fairness to ShapeDiver
- [ ] Live demo instance hosted at a stable URL with sample definitions loaded
- [ ] Favicon, apple-touch-icon
- [ ] OG image (1200×630, can be a still from the hero video)
- [ ] Imprint and privacy pages drafted
- [ ] Contact email live and monitored

## Open questions before build

- **Domain choice** — confirm available and registered
- **Hosted demo** — where does it run, who maintains the sample definitions, how often is it reset
- **Contact channel** — single email (e.g. `hello@selva.dev`) or contact form
- **AG legal name and contact** — required for imprint
- **VektorNode brand alignment** — does the site say "by VektorNode AG" prominently, or only in the footer? Recommendation: footer + the "Who builds it" section. Not in the nav.

---

## Revision log

- 2026-05-11: Initial draft. Structure locked, copy to be iterated against real screenshots once available.
