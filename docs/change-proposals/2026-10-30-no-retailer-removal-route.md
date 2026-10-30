# Change note: no Contact page and no retailer removal route

_Decided by the user on 2026-10-30 ("we don't need a section for retailers to request removal", then option 1: drop the Contact page entirely). Applied by the SM on the same day, in the shards and in `docs/prd.md`, the design spec, the architecture and the README._

## What changed

- **FR20:** About / How it works and Privacy pages only. No Contact page, no removal route. A store that does not want to be read says so in its `robots.txt` (the pipeline obeys it, FR5), and the operator can hide any store at once (`pnpm ops:hide`).
- **Story 2.5:** criterion 3 (About with a short "Our bot" part, Privacy, no Contact page) and 4 (a footer with two links).
- **Story 4.5:** criterion 4 is now that `/contact` forwards to the "Our bot" part of the About page.
- **Human prerequisite 4** (a monitored email address for removal requests) is dropped.
- **NFR6 and Story 3.2 criterion 1:** the user-agent "links to a page about the bot" (it was "with a contact address").
- **UI goals, the design spec, the architecture and the README:** the Contact page, the "Retailer asks to be removed" flow, the header and footer links and the `/contact` route are removed or changed.

## One consequence worth knowing

The pipeline's user-agent is `SaleawayBot/1.0 (+https://saleaway.online/contact)` (Story 3.2, deployed). With no Contact page that address would be a dead link, and an honest bot should point somewhere. **Decision (SM, best judgement, the user may overrule):** keep the address and make `/contact` a redirect to `/about#our-bot`, where the About page has a short "Our bot" part (what the bot is, about one request a day per store, obeys robots.txt). No pipeline change or redeploy is needed. The user-agent no longer carries an email address, so NFR6's "contact address" became "a link to a page about the bot".

## Trade-off accepted

A retailer who objects has no way to write to us. `robots.txt` is the standard way to say no and is obeyed; any store can be hidden within minutes by the operator.
