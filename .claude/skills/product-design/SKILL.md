---
name: product-design
description: Design and build distinctive web products - landing pages, multi-page sites, dashboards, admin panels, and full app UIs. Forces a unique aesthetic direction (Vibe Discovery) plus, depending on scope, a Copy Strategy (marketing) or an Interface Contract (systems) before any code. Use when the user asks for a landing page, marketing page, site, website, portfolio, docs site, dashboard, painel, admin, CRUD, SaaS, sistema, aplicativo web, or any UI that should not look AI-generated.
---

# Product Design

Build web products that don't look AI-generated. Works for a one-screen landing
page and for a 40-screen system. The discipline is the same; the specs differ.

## Step 0: Scope Routing (always first)

Ask, or infer from the request, which track this is:

| Track | What it is | Required specs |
|-------|-----------|----------------|
| **A. Marketing** | Landing page, product launch, one-pager | Vibe Spec + Copy Strategy Spec |
| **B. Site** | Multi-page site, portfolio, docs, blog | Vibe Spec + Information Architecture |
| **C. System** | Dashboard, admin, CRUD, SaaS app, internal tool | Vibe Spec + Interface Contract |

Mixed products (marketing site + app behind login) are two tracks. Do the
Vibe Discovery **once** so both halves share one visual identity.

## Vibe Discovery (all tracks, before any code)

Four questions. Do not skip, do not answer them for the user unless they say
"just pick".

1. **Real-world reference** - a place, object, era, or material this should feel
   like. Colors get derived from it, never from memory.
2. **Emotional temperature** - what should the user feel in the first 3 seconds?
3. **Collision** - two unrelated influences to combine (e.g. "Swiss rail
   signage x arcade cabinet"). Both must be visible in the result.
4. **Wildcard** - one element that deliberately doesn't fit.

Then write the **Vibe Spec**: named vibe, color tokens (as CSS variables),
type pairing, icon set, motion vocabulary, and the one memorable element.
An unnamed vibe becomes generic.

### Freshness Check

Reject and redo if any of these are true:

- Fonts: Inter, Roboto, Open Sans, Lato. Use Newsreader, Playfair Display,
  Clash Display, Outfit, Manrope, Satoshi, Instrument Sans, Geist.
- Icons: Lucide. Use Iconify Solar, Phosphor, Heroicons, Remix.
- Colors: purple gradients, the "Stripe palette", blue-to-purple anything.
- No display font rotation from the last project.
- Both collision influences are not visible.

## Track A: Copy Strategy (marketing only)

`Purchase Rate = Desire - (Labor + Confusion)`

1. Discover the top 3 buying objections. Address each on the page.
2. Headline = Value Prop + Hook.
3. **Litmus test**: headline alone, nothing else - does the visitor know what
   you sell? If not, rewrite.
4. CTA continues the headline's story. "Find food near me", not "Get started".
5. Spend 50% of effort on the hero. It is the preview image, the first
   impression, the hook.

Section order: Hero → Features/Benefits → Social Proof → How It Works →
Pricing → Final CTA → Footer. Never fake social proof; omit it instead.

## Track B: Information Architecture (sites)

Before building, write:

- **Page inventory** - every route, its job, its primary action.
- **Nav model** - what's in the top nav (max 5), what's in the footer, what's
  reachable only by link.
- **Shared shell** - header, footer, page container. Build it once; every page
  imports it.
- **The one page that matters** - usually home or a key product page. Give it
  the 50% rule; the rest inherit the system.

## Track C: Interface Contract (systems)

A system is judged on the boring screens, not the hero. Before building, write:

- **Entities and actions** - the nouns, and what a user can do to each
  (list / view / create / edit / delete / bulk).
- **Screen map** - list → detail → edit, plus every modal and empty route.
- **State matrix** - for every data view: loading, empty, error, partial,
  full, too-much (pagination/virtualization threshold). Design empty first;
  it is the screen new users actually see.
- **Form rules** - validation timing, error placement, destructive-action
  confirmation, unsaved-changes guard.
- **Permissions** - what a viewer sees that an admin does, and what happens
  to the UI when an action is not allowed (hidden vs disabled + reason).

### System-specific design rules

- **Density is a decision.** Pick comfortable / compact and apply it to every
  table, list, and form. Don't mix.
- **One layout shell.** Sidebar or top nav, chosen once. Every screen lives
  inside it, including errors and empties.
- **Tables are the product.** Sticky header, sortable columns, visible row
  actions, a real empty state, and horizontal scroll contained in the table -
  never the page.
- **The vibe lives in the chrome**, not the data. Personality goes into nav,
  empty states, buttons, loading states, micro-copy. Data stays legible.
- **Keyboard reachable.** Focus rings visible, tab order sane, Esc closes,
  Enter submits.
- **No dead ends.** Every error and empty state offers the next action.

## Build Order (all tracks)

1. **Tokens first** - colors, type scale, spacing, radii, shadows as CSS
   variables. Everything downstream reads from them.
2. **Shell / hero** - the piece that sets identity (hero for A, page shell for
   B, app shell + one real screen for C).
3. **Incremental sections or screens** - one at a time, each validated
   against the spec before the next.
4. **Polish** - responsive, states, motion, accessibility, load time.

## Quality Gates

**Visual (all tracks)**
- [ ] No banned fonts, icons, or colors from the Freshness Check
- [ ] Color system as CSS variables, no hardcoded hex in components
- [ ] Both collision influences visible; wildcard present
- [ ] At least one memorable element
- [ ] Mobile responsive; no horizontal page scroll
- [ ] Accessible contrast; visible focus states
- [ ] Dark mode handled or deliberately declined

**Track A**
- [ ] Headline passes the litmus test
- [ ] CTA is narrative continuation, not "Get Started"
- [ ] Top 3 objections addressed; social proof real or absent

**Track B**
- [ ] Every route in the inventory exists and is reachable
- [ ] Shared shell used by every page; nav state correct per route
- [ ] 404 designed, not default

**Track C**
- [ ] Every data view has loading, empty, and error states
- [ ] Destructive actions confirm; forms guard unsaved changes
- [ ] Long lists paginate or virtualize
- [ ] Disabled actions explain why
- [ ] Works keyboard-only for the primary flow

## Animation Vocabulary

Entrance: fade-in, blur-in, slide-in, scale-in, stagger.
Continuous: marquee, beam, pulse, float, rotate.
Interactive: hover-lift, hover-glow, hover-reveal, ripple.
Decorative: grid lines, curves, gradient orbs, grain.

Systems get less: entrance on route change, hover on interactive elements,
skeletons on load. Nothing that delays a user doing the same task 50 times.

## Resources

Fonts: Google Fonts, Fontshare. Icons: Iconify, Simple Icons.
Inspiration: superhero.design, Awwwards, Dribbble, Mobbin (app UI), UI Sources.
