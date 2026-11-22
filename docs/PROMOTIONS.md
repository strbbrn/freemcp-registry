# First-party promotions (D1)

The homepage and server directory render text-only, animated, first-party promotions from the D1 `promotions` table. No image assets or third-party ad scripts are used. Promotions are clearly labeled and hidden when the database is unavailable.

## Setup

Apply `migrations/0007_promotions.sql` then `migrations/0008_promotion_slots.sql`, and finally `migrations/0009_directory_footer_promotion.sql` to the **preview D1 database first**, then production after review. All three migrations are required for the updated API. Cloudflare Pages must bind the same D1 database as `DB`. The migrations create 32 active entries across the primary, strip, inline, sidebar, bottom, and footer slots. All three page types have multiple independent slots: homepage `home/primary` and `home/strip`; directory `directory/primary`, `directory/inline`, and `directory/footer` (a compact promotion just above the site footer) (inline after every seventh server row (7, 14, 21 on a 24-row page), omitting positions beyond the current result count); detail pages `detail/sidebar` and `detail/bottom` (the redundant primary landscape banner is intentionally not mounted). Detail pages use standalone static CSS/JS assets because they are rendered by a Cloudflare Pages Function rather than Astro.

## Edit without deploying

```sql
UPDATE promotions SET headline='Your new headline', description='Your new copy', updated_at=CURRENT_TIMESTAMP WHERE id='agentagi-home';
UPDATE promotions SET status='paused' WHERE id='creditcard-home';
UPDATE promotions SET rotation_seconds=10, weight=2 WHERE id='autonomousagents-directory';
```

Changes become visible after the API cache expires (up to 60 seconds). Use one row per campaign, placement and slot. The API accepts `placement=home|directory|detail` and `slot=primary|strip|inline|sidebar|bottom|footer`. `status` is `draft`, `active`, or `paused`; `starts_at` and `ends_at` are optional UTC SQLite datetime strings. `weight` is between 1 and 20 and `rotation_seconds` is between 5 and 30.

The starter destination URLs are the four supplied domains. **Verify they lead to suitable landing pages** before production deployment, especially the domains offered for sale. Change `target_url` in D1 when an inquiry page becomes available.

## UX and security

Ads rotate every 7 seconds by default; they pause on hover, keyboard focus, when the page is hidden, and when the user prefers reduced motion. A Next button allows manual advancement. No personal identifiers, click tracking, or analytics are collected. Text is inserted via `textContent` and target links must be HTTPS. A single frontend component controls all CSS animations and themes; D1 controls copy, destinations, theme, weight, status, schedule and interval.

## Production rollout (after merging PR #31)

Back up production D1 before making changes. These commands explicitly target the production database and must **not** be run against preview. From the repository root with Wrangler authenticated:

```bash
npx wrangler d1 export freemcp-prod-registry --remote --output=freemcp-prod-before-promotions.sql
npx wrangler d1 execute freemcp-prod-registry --remote --file=./migrations/0007_promotions.sql
npx wrangler d1 execute freemcp-prod-registry --remote --file=./migrations/0008_promotion_slots.sql
npx wrangler d1 execute freemcp-prod-registry --remote --file=./migrations/0009_directory_footer_promotion.sql
npx wrangler d1 execute freemcp-prod-registry --remote --command="SELECT placement, slot, COUNT(*) AS campaigns FROM promotions GROUP BY placement, slot ORDER BY placement, slot;"
```

Expected: **32 rows**, with four campaigns in each of eight groups: home/primary, home/strip, directory/primary, directory/inline, directory/footer, detail/primary, detail/sidebar, and detail/bottom. Detail/primary is seeded for compatibility but deliberately not displayed. The directory/footer slot is visually **above** the footer links. 

**Important:** `0008` adds the `slot` column using `ALTER TABLE` and is **not safe to rerun** after it succeeds. If production already has any part of the schema, inspect it before running the commands; do not blindly replay the migrations. Check production `/api/ads?placement=directory&slot=footer` and the actual pages after deployment. Promotions return no entries until the corresponding database migration is present.
