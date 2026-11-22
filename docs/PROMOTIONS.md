# First-party promotions (D1)

The homepage and server directory render text-only, animated, first-party promotions from the D1 `promotions` table. No image assets or third-party ad scripts are used. Promotions are clearly labeled and hidden when the database is unavailable.

## Setup

Apply `migrations/0007_promotions.sql` and then `migrations/0008_promotion_slots.sql` to the **preview D1 database first**, then production after review. Both migrations are required for the updated API. Cloudflare Pages must bind the same D1 database as `DB`. The migrations create 28 active entries across the primary, strip, inline, sidebar, and bottom slots. All three page types have multiple independent slots: homepage `home/primary` and `home/strip`; directory `directory/primary` and `directory/inline` (inline after every seventh server row (7, 14, 21 on a 24-row page), omitting positions beyond the current result count); detail pages `detail/sidebar` and `detail/bottom` (the redundant primary landscape banner is intentionally not mounted). Detail pages use standalone static CSS/JS assets because they are rendered by a Cloudflare Pages Function rather than Astro.

## Edit without deploying

```sql
UPDATE promotions SET headline='Your new headline', description='Your new copy', updated_at=CURRENT_TIMESTAMP WHERE id='agentagi-home';
UPDATE promotions SET status='paused' WHERE id='creditcard-home';
UPDATE promotions SET rotation_seconds=10, weight=2 WHERE id='autonomousagents-directory';
```

Changes become visible after the API cache expires (up to 60 seconds). Use one row per campaign, placement and slot. The API accepts `placement=home|directory|detail` and `slot=primary|strip|inline|sidebar|bottom`. `status` is `draft`, `active`, or `paused`; `starts_at` and `ends_at` are optional UTC SQLite datetime strings. `weight` is between 1 and 20 and `rotation_seconds` is between 5 and 30.

The starter destination URLs are the four supplied domains. **Verify they lead to suitable landing pages** before production deployment, especially the domains offered for sale. Change `target_url` in D1 when an inquiry page becomes available.

## UX and security

Ads rotate every 7 seconds by default; they pause on hover, keyboard focus, when the page is hidden, and when the user prefers reduced motion. A Next button allows manual advancement. No personal identifiers, click tracking, or analytics are collected. Text is inserted via `textContent` and target links must be HTTPS. A single frontend component controls all CSS animations and themes; D1 controls copy, destinations, theme, weight, status, schedule and interval.
