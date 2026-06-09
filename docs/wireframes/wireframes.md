# TMPC Website — ASCII Wireframes

Structure-only diagrams of every page (final, post-audit layouts). Boxes are layout regions, not visual styling. Grid rows show one representative card row; real grids are 1 column at 375px, 2 at ~620px, 3 at ~940px.

## Home (`/`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|                                                                |
|HERO (navy) — eyebrow, church name (display), tagline, [Plan Yo…|
|                                                                |
+----------------------------------------------------------------+
|      ANNOUNCEMENTS — gold-edged notice bars (conditional)      |
+----------------------------------------------------------------+
|                   NEXT STEPS — 4 link cards                    |
| +------------++------------++------------++------------+       |
| |  I'm New   ||Sunday Scho…|| Ministries ||  Messages  |       |
| +------------++------------++------------++------------+       |
+----------------------------------------------------------------+
|      SERVICE TIMES (navy band) — eyebrow, h2, times text       |
+----------------------------------------------------------------+
|        LATEST SERMONS — section head + "view all" link         |
+----------------------------------------------------------------+
| +------------------++------------------++------------------+   |
| |sermon card (thum…||   sermon card    ||   sermon card    |   |
| +------------------++------------------++------------------+   |
+----------------------------------------------------------------+
|        UPCOMING EVENTS — section head + "view all" link        |
+----------------------------------------------------------------+
| +------------------++------------------++------------------+   |
| |event card (title…||    event card    ||    event card    |   |
| +------------------++------------------++------------------+   |
+----------------------------------------------------------------+
|SUNDAY SCHOOL SPOTLIGHT (band) — copy + [Explore Sunday School] |
+----------------------------------------------------------------+
|       MISSION (navy band) — eyebrow + mission statement        |
+----------------------------------------------------------------+
|        GIVE CTA (centered band) — h2, lede, [Give Now]         |
|                                                                |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Landing page: welcome hero, quick next-step paths, service times, latest sermons and events, Sunday School spotlight, mission, and giving call-to-action.*

## About (`/about`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|  PAGE INTRO — eyebrow, h1 "About Us", lede, [What We Believe]  |
|                                                                |
+----------------------------------------------------------------+
|        MISSION (navy band) — eyebrow, h2, mission text         |
+----------------------------------------------------------------+
|                    OUR TEAM — section head                     |
+----------------------------------------------------------------+
| +------------------++------------------++------------------+   |
| |staff card (4:5 p…||    staff card    ||    staff card    |   |
| +------------------++------------------++------------------+   |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Who the church is: intro copy, mission statement, and staff/team cards with portraits.*

## What We Believe (`/beliefs`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|        PAGE INTRO — eyebrow, h1 "What We Believe", lede        |
|                                                                |
+----------------------------------------------------------------+
|                                                                |
|          STATEMENT OF FAITH — prose column (max 66ch)          |
|                                                                |
+----------------------------------------------------------------+
|    VISIT CTA (centered band) — h2, copy, [Plan your visit]     |
|                                                                |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Statement of faith as long-form prose, ending in an invitation to visit.*

## Sunday School (`/sunday-school`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|         PAGE INTRO — eyebrow, h1 "Sunday School", lede         |
|                                                                |
+----------------------------------------------------------------+
|        WHEN WE MEET (navy band) — eyebrow, h2, schedule        |
+----------------------------------------------------------------+
|                   OUR CLASSES — section head                   |
+----------------------------------------------------------------+
| +------------------++------------------++------------------+   |
| |class card (name/…||    class card    ||    class card    |   |
| +------------------++------------------++------------------+   |
+----------------------------------------------------------------+
|      VISIT CTA (centered band) — h2, copy, [Plan a Visit]      |
|                                                                |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Sunday School overview: intro, meeting schedule, class cards by age group, and a visit invitation.*

## Ministries (`/ministries`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|          PAGE INTRO — eyebrow, h1 "Ministries", lede           |
|                                                                |
+----------------------------------------------------------------+
| +------------------++------------------++------------------+   |
| |ministry card (16…||  ministry card   ||  ministry card   |   |
| +------------------++------------------++------------------+   |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Directory of ministries: image cards with description, leader, and contact email.*

## Sermons (`/sermons`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|            PAGE INTRO — eyebrow, h1 "Sermons", lede            |
+----------------------------------------------------------------+
|         SEARCH FORM — [ text input          ] [Search]         |
+----------------------------------------------------------------+
| +------------------++------------------++------------------+   |
| |sermon card (thum…||   sermon card    ||   sermon card    |   |
| +------------------++------------------++------------------+   |
+----------------------------------------------------------------+
|          PAGINATION — [Previous]  Page X of Y  [Next]          |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Searchable sermon archive: search bar, YouTube-thumbnail cards, and pagination.*

## Sermon Detail (`/sermon-detail`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|                       ← Back to sermons                        |
+----------------------------------------------------------------+
|     TITLE BLOCK — eyebrow, h1 sermon title, pastor · date      |
+----------------------------------------------------------------+
|                                                                |
|       VIDEO EMBED — 16:9 YouTube iframe (navy fallback)        |
|                                                                |
+----------------------------------------------------------------+
|                   DESCRIPTION — prose column                   |
|                                                                |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Single sermon: back link, title and meta, embedded 16:9 video, and description.*

## Events (`/events`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|         PAGE INTRO — eyebrow, h1 "Events", lede, rule          |
|                                                                |
+----------------------------------------------------------------+
| +------------------++------------------++------------------+   |
| |event card (title…||    event card    ||    event card    |   |
| +------------------++------------------++------------------+   |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Upcoming events listed as cards with date, time, location, and description.*

## Give (`/give`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|             PAGE INTRO — eyebrow, h1 "Give", lede              |
|                                                                |
+----------------------------------------------------------------+
|                                                                |
|      GIVING EMBED — 16:9 iframe (portal) + fallback link       |
|                                                                |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Online giving: intro copy and an embedded giving-portal iframe with a fallback link.*

## Plan a Visit (`/visit`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|  PAGE INTRO — eyebrow, h1 "Plan a Visit", lede, flash (cond.)  |
+----------------------------------------------------------------+
| +----------------------------++----------------------------+   |
| |WHAT TO EXPECT — prose, ser…||CONTACT FORM — name / email…|   |
| +----------------------------++----------------------------+   |
+----------------------------------------------------------------+
|                  MAP EMBED — 16:8 map iframe                   |
|                                                                |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*First-time visitor page: what to expect, service times and address, an "I'm coming" form, and a map.*

## Contact (`/contact`)

```
+----------------------------------------------------------------+
|      HEADER — logo | nav links | Plan a Visit / Give CTAs      |
+----------------------------------------------------------------+
|    PAGE INTRO — eyebrow, h1 "Contact", lede, flash (cond.)     |
+----------------------------------------------------------------+
| +----------------------------++----------------------------+   |
| |CONTACT INFO — address / ph…||CONTACT FORM — name / email…|   |
| +----------------------------++----------------------------+   |
+----------------------------------------------------------------+
|                  MAP EMBED — 16:8 map iframe                   |
|                                                                |
+----------------------------------------------------------------+
|FOOTER — church + tagline | visit info | connect links | copyri…|
|                                                                |
+----------------------------------------------------------------+
```

*Contact page: address, phone, email, service times beside a message form, with a map below.*

## Admin Login (`/admin-login`)

```
+----------------------------------------------------------------+
|   ADMIN HEADER — brand | section links | View site | Log out   |
+----------------------------------------------------------------+
|                                                                |
| AUTH CARD (centered, 420px) — h1, username, password, [Log In] |
|                                                                |
+----------------------------------------------------------------+
```

*Authentication: centered narrow card with username/password form. No public footer.*

## Admin Dashboard (`/admin-dashboard`)

```
+----------------------------------------------------------------+
|   ADMIN HEADER — brand | section links | View site | Log out   |
+----------------------------------------------------------------+
|                         h1 "Dashboard"                         |
+----------------------------------------------------------------+
|                           STAT GRID                            |
| +-------++-------++-------++-------++-------++-------+         |
| |Sermons||Events ||Minist…|| Staff ||S. Sch…||Announ…|         |
| +-------++-------++-------++-------++-------++-------+         |
+----------------------------------------------------------------+
|  MANAGE — quick-nav buttons (Sermons, Events, Ministries, …)   |
+----------------------------------------------------------------+
```

*Admin home: six content-count stat tiles and quick-nav buttons to each manager.*

## Admin List (Sermons/Events/Staff/…) (`/admin-list`)

```
+----------------------------------------------------------------+
|   ADMIN HEADER — brand | section links | View site | Log out   |
+----------------------------------------------------------------+
|            ADMIN BAR — h1 section name | [Add New]             |
+----------------------------------------------------------------+
|          FLASH — success / error notice (conditional)          |
+----------------------------------------------------------------+
|                                                                |
|   DATA TABLE — th row + data rows, each with [Edit] [Delete]   |
|                                                                |
+----------------------------------------------------------------+
|          PAGINATION — [Previous]  Page X of Y  [Next]          |
+----------------------------------------------------------------+
```

*Shared manager layout: title + Add New, flash messages, data table with row actions, pagination. Table stacks to labeled blocks under 680px.*

## Admin Form (add/edit record) (`/admin-form`)

```
+----------------------------------------------------------------+
|   ADMIN HEADER — brand | section links | View site | Log out   |
+----------------------------------------------------------------+
|                      ← Back to <section>                       |
+----------------------------------------------------------------+
|                       h1 "Add / Edit …"                        |
+----------------------------------------------------------------+
|                                                                |
|   FORM — stacked label+input fields, upload controls, notes    |
|                                                                |
+----------------------------------------------------------------+
|                      [Save] submit button                      |
+----------------------------------------------------------------+
```

*Shared create/edit layout: back link, title, stacked labeled fields (640px max), optional upload row, submit button.*

