# Sprint Change Proposal: Stores that block the pipeline (risk R2)

_Prepared by Sarah (PO) on 2026-10-30, batch mode, using `.bmad-core/checklists/change-checklist.md`. Status: **approved by the user and applied on 2026-10-30** (all 14 edits, in the shards and in `docs/prd.md`; the R2 row in the architecture shard and in `docs/architecture.md`)._

## 1. Analysis summary

**Trigger.** Story 3.2 (spike S2) fetched every store from the deployed Worker, once, with the honest user-agent. Of the 89 stores that were fetched, **34 (38 percent) answered 403 (21) or 429 (13)**, including 12 of the 18 Shopify stores. `robots.txt` forbade nothing. The same pages loaded from a home connection in the earlier spike (24 of the 54 stores marked `verified_products` were blocked), so the Worker's network is the likely cause, not the user-agent. The first plan assumed only three stores (Amazon.co.za, Game, Checkers) would block.

**Decisions already taken by the user.** Contacting retailers is not an option. The user chose to launch with the stores that work and hide the others (Story 3.9, drafted and validated, 35 stores hidden, 57 shown).

**Is this a one-off or a pattern?** A pattern, and unlikely to fix itself. It was foreseeable: the PRD listed "bot blocking from Cloudflare IP ranges" as a technical risk and asked for this very test. The wrong assumption was the number of blocked stores (three).

**Checklist findings**

| Checklist area | Finding |
|---|---|
| 1. Trigger and context | A technical limit found by the planned spike. Evidence: run 16 on the live database, `docs/fetch-spike.md`. |
| 2. Epic impact | Epic 1, 2: none. Epic 3: Story 3.9 added; 3.4 (criterion 7 and 8), 3.6 (criteria 2 and 3), 3.8 (trigger) need text changes; 3.3 and 3.5 are unaffected. Epic 4: 4.1 (needs a way to show a hidden store with manual values), 4.3 (can double as the home-network test), 4.5 (known issues). Epic 5: one new story (5.4). |
| 3. Artifact conflicts | PRD: background, technical assumptions, FR2, human prerequisite 3, launch-critical set. Architecture: the R2 row. The domain (`saleaway.co.za`) is still in the PRD, the brief and the idea file. No UI change. |
| 4. Path | **Direct adjustment** (checklist option 1). No rollback, no change of platform. The MVP scope is **reduced for launch, not changed**: the launch store count becomes 57 instead of 92, with a defined route to bring stores back. |

**Why this path.** The alternatives were: (a) wait for retailers to allow the bot (ruled out by the user), (b) change the fetching to look like a browser or use proxies (against NFR6, and it would invite harder blocks), (c) move everything to another network now (unproven, and possibly blocked too). Hiding costs nothing, is reversible, and keeps the launch date. The stores come back one by one in Story 5.4, using what Story 4.3 learns for free.

**MVP impact.** The home page launches with 57 stores (53 that answer, 3 manual, 1 with a data error) across all 10 categories (at least 3 stores in each). Black Friday is 27 November, so there are about 4 weeks to recover stores. The 14 stores that answered 200 but load products with JavaScript still need Epic 5 (Story 5.1).

**Plan for the handoff.** A PO/SM can apply all edits below. No PM or Architect replanning is needed. The Architect's only item is the R2 row (edit 12).

## 2. Proposed edits

Each edit applies to **both** the shard and the matching text in `docs/prd.md` (and `docs/architecture.md` for edit 12), identically.

**Edit 1: the domain is `saleaway.online`.** Replace `saleaway.co.za` with `saleaway.online` in `docs/prd.md`, `docs/prd/goals-and-background-context.md`, `docs/prd/epic-4-overrides-operations-launch-readiness.md` (Story 4.4 and 4.5), `docs/prd/launch-critical-set-and-human-prerequisites.md`, `docs/brief.md` and `docs/idea.md`. Not changed: the change log rows and the stories that quote the old name on purpose (3.2, 3.9, `docs/fetch-spike.md`).

**Edit 2: human prerequisite 3** (`prd.md` and `launch-critical-set-and-human-prerequisites.md`).
- From: "The domain saleaway.co.za registered, with its nameservers pointed at Cloudflare (otherwise a temporary `workers.dev` address is used, ... ). Start this early, since nameserver changes can take hours | Story 4.4"
- To: "The domain `saleaway.online`, registered in Cloudflare (**done 2026-10-30**), so its DNS is already on Cloudflare. Story 4.4 attaches it to the web Worker | Story 4.4"

**Edit 3: technical assumptions** (`prd.md` and `technical-assumptions.md`).
- Replace "The first fetch test came from a home connection. Re-run it from a real Worker early (Story 3.2), since Cloudflare IP ranges may be blocked more often." with: "**Done in Story 3.2 (2026-10-30):** from the deployed Worker, 34 of the 89 stores fetched answered 403 or 429 (12 of the 18 Shopify stores answered 429), although the same pages loaded from a home connection. The honest user-agent is kept and no evasion is attempted (NFR6). Contacting retailers is ruled out. These stores, and one more listing on the same website, are hidden for launch (Story 3.9) and brought back one by one in Story 5.4."
- Append to "Known blocked stores (Amazon.co.za, Game, Checkers) default to the manual extraction method.": " Another 35 stores are hidden by decision (`docs/data/hidden-stores.json`)."
- Replace the Story 3.8 bullet: "If the CPU measurement in Story 3.2 shows ... (Story 3.8, conditional)." with: "The CPU limit does not stop the Worker: Story 3.2 measured 5 to 108 ms per store, and Cloudflare does not enforce 10 ms on queue consumers. A fallback runner on GitHub Actions or another free network (Story 3.8, conditional) is built only if Story 4.3 or Story 5.4 shows that a different network gets through where the Worker is blocked."

**Edit 4: FR2** (`requirements.md` and `prd.md`). Append: " Stores that block the pipeline are hidden by a recorded decision (`docs/data/hidden-stores.json`, Story 3.9), not deleted, so they can be shown again."

**Edit 5: launch store count** (`launch-critical-set-and-human-prerequisites.md` and `prd.md`). Add under the launch-critical list: "**Launch store count (decided 2026-10-30):** the site launches with the stores that work from the Worker, 57 of the 92 with a sale page (Story 3.9). The other 35 come back in Story 5.4."

**Edit 6: Story 3.4, criteria 7 and 8** (epic 3 and `prd.md`).
- Criterion 7, from: "Under Armour SA and Wellness Warehouse (both Shopify) are covered as the first examples."
- To: "The Shopify stores that answered the Worker in Story 3.2 (`beauty-on-tapp`, `norman-goodfellows`, `toy-kingdom`) are covered as the first examples, after confirming that each one's `/products.json` also answers the Worker. Under Armour SA is a custom storefront with no product feed (Story 3.2) and uses the `html` method. Wellness Warehouse is hidden (blocked)."
- Criterion 8: after "(Bash, Woolworths, Takealot and Under Armour SA)" add "and one Shopify store whose product feed answers, because Story 3.2 could not measure the JSON path".

**Edit 7: Story 3.6, criteria 2 and 3** (epic 3 and `prd.md`).
- Criterion 2: "... blocked, not found, and errors" becomes "... blocked, not found, errors, and hidden".
- Criterion 3: "Stores that need manual handling are listed with their reason." becomes "Stores that need manual handling are listed with their reason, and the stores hidden by Story 3.9 are listed with theirs (from `docs/data/hidden-stores.json`)."

**Edit 8: Story 3.8** (epic 3 and `prd.md`; the heading stays).
- The "so that" line, from "if Cloudflare's CPU limit is too tight" to "if the Worker cannot read the pages it needs (blocked by the retailer, or too much CPU)".
- Criterion 1, from: "This story is built only if the CPU measurement in Story 3.2 (AC6) shows the Worker cannot handle the pages it needs to. Otherwise it is skipped."
- To: "This story is built only if Story 4.3 or Story 5.4 shows that a different free network gets through for stores that block the Worker, or if the CPU measurement in Story 3.4 (criterion 8) shows the Worker cannot handle the pages it needs. The CPU measurement in Story 3.2 fits, so it is not a reason by itself. Otherwise it is skipped. Retailers are not contacted, and nothing is done to hide who the bot is (NFR6)."
- Also in the "Conditional" bullet of the launch-critical set: "built only if the CPU measurement in Story 3.2 fails" becomes "built only if a different network gets through where the Worker is blocked, or the CPU measurement in Story 3.4 fails".

**Edit 9: Story 4.1** (epic 4 and `prd.md`).
- Criterion 1, add at the end: "Hiding a store here (an override) is not the same as hiding it with `is_visible` (Story 3.9): an override hide only removes the store from the site, and the pipeline still fetches it."
- New criterion 8: "A store hidden by Story 3.9 can be shown with manual values in one step: the command sets it to the `manual` method (so the pipeline never fetches it again), makes it visible, adds the manual override, and removes the store from `docs/data/hidden-stores.json`. Without the `manual` method, showing it would make the pipeline fetch a blocked store every night."

**Edit 10: Story 4.3** (epic 4 and `prd.md`). New criterion 6: "The script runs from the operator's computer with the pipeline's user-agent and its `robots.txt` and URL-safety rules (these are shared code in `packages/core`), at most once a day, and records for each store hidden by Story 3.9 whether it answers from there. This is the free test of another network, and its result is the input for Story 5.4 and for Story 3.8."

**Edit 11: Story 4.5, criterion 6.** "The remaining known issues are listed." becomes "The remaining known issues are listed, including the stores hidden by Story 3.9 and why."

**Edit 12: architecture, risk R2** (`risks-and-spikes.md` and `docs/architecture.md`). Replace the last sentence of the R2 row, "Blocked stores are set to `manual`", with: "Blocked stores are hidden for launch (Story 3.9, 35 stores) and brought back in Story 5.4 (a re-test, another network, or manual values for the biggest names). Retailers are not contacted."

**Edit 13: new Story 5.4** (epic 5, `prd.md`, `prd/index.md`; goes after Story 5.3).

> ## Story 5.4 Bring Blocked Stores Back
>
> As the operator,
> I want the stores hidden by Story 3.9 re-tested and returned one by one,
> so that coverage grows before Black Friday.
>
> ### Acceptance Criteria
>
> 1. Each hidden store is re-tested with `POST /admin/run?store=<slug>`, and from another free network if Story 4.3 showed that it answers there. Blocking is not stable, so each store is judged on a fresh result.
> 2. A store that answers is shown again and removed from `docs/data/hidden-stores.json`.
> 3. A store that still blocks is either entered by hand with the `manual` method and an override (Story 4.1, criterion 8) for the biggest names by rank, or stays hidden. The decision for each store is recorded in the list.
> 4. If another network answers for several stores, Story 3.8 (fallback runner) is built for those stores only, and each store is handled by exactly one runner.
> 5. Retailers are not contacted, and nothing is done to hide who the bot is (NFR6).
> 6. The number of visible stores before and after is recorded in the README.

**Edit 14: the PRD change log** (`prd.md`, new row): "2026-10-30 | 0.7 | Sprint change (correct-course) after the first live run: launch with 57 stores, blocked stores hidden (Story 3.9), edits to Stories 3.4, 3.6, 3.8, 4.1, 4.3 and 4.5, new Story 5.4, domain `saleaway.online`, risk R2 updated | Sarah (PO)".

## 3. What is not changed

- The honest user-agent, `robots.txt` handling and the one-fetch-per-day rule (NFR6).
- Epic 2 (the public site), Story 3.3, 3.5 and 3.7, Story 4.2, 4.4 and 4.6. The 3.5 rule that a store whose fetch fails for more than 72 hours is hidden stays: it is the automatic rule for a store that breaks later; Story 3.9 is the decision for stores that were never reachable.
- The deadline (31 October for the launch, 27 November for Black Friday).

## 4. Risks left open

1. **Blocking can get worse.** A store that works today may block tomorrow. Story 3.5's 72-hour rule hides it automatically, and the health report (Story 4.2) shows it.
2. **A thin launch.** 57 stores, of which 14 can only show "On sale" until Story 5.1, and 3 need manual values. The site is honest, but the "Biggest discounts today" card (Story 3.7) may have few percentages to show at launch.
3. **Another network may be blocked too.** Story 4.3 will tell us for free. If it is, the fallback is manual values for the biggest names.

## 5. Approval

The user approves the whole proposal, or says which edits to change or drop. Then the PO applies the edits (shards and `docs/prd.md` together), and Bob continues with Story 3.9.
