# Hotel Social Reports

A small working prototype for a marketing agency that runs social media for hotels. It:

- **imports** each hotel's daily social-media numbers from a CSV file,
- builds a **monthly report** whose numbers are double-checked,
- keeps **each hotel's data completely separate**, and
- lets a report leave the building (as HTML, CSV or JSON) **only after a second person approves it**.

It comes with made-up data for two **fictional** hotels:

| ID | Hotel | What its data looks like |
|---|---|---|
| `harbourlight` | Harbourlight Boutique Hotel (coastal city) | Mostly Instagram, steady growth |
| `pinecrest` | Pinecrest Mountain Lodge (ski & hiking) | Mostly TikTok and Facebook, a big October rush |

The server is plain Python with no extra packages to install. The website, called *Night Audit*, is a React app
in `frontend/`. A ready-built copy is included in `frontend/dist/` and the Python server hands it out, so you only
need Node.js if you want to change the website.

## Demo video

A 3-minute walkthrough is in [`Demo_video.mov`](Demo_video.mov).

---

## Getting started

**You need:** Python 3.10 or newer, and a web browser. That's all, with no `pip install` and no database to set up.

```bash
git clone https://github.com/<your-username>/<repo-name>.git
cd <repo-name>
python3 cli.py reset        # creates the sample data: Harbourlight empty, Pinecrest with an approved October report
python3 app.py              # then open http://127.0.0.1:8000
```

If port 8000 is already in use, run `python3 app.py --port 8080` instead. Stop the server with `Ctrl+C`.
Run `python3 cli.py reset` again whenever you want a clean start.

On the front page, **take a key** to sign in. Every key is a demo account with the password **`demo123`**,
which is filled in for you. An older, simpler version of the website is still at `http://127.0.0.1:8000/classic`.

| Username | Name | Hotel | Role |
|---|---|---|---|
| `anna@harbourlight` | Anna Patel | Harbourlight | Analyst |
| `rob@harbourlight` | Rob Chen | Harbourlight | Reviewer |
| `paul@pinecrest` | Paul Okafor | Pinecrest | Analyst |
| `rita@pinecrest` | Rita Novak | Pinecrest | Reviewer |

### Try it in two minutes
1. Take **Anna's** key and click **Use the sample ledger**. 183 rows are accepted and 3 broken rows are turned away, each with the reason.
2. Click **Compose & check →** to build the October report, then **Submit for review**.
3. Click **Pinecrest** in the top menu. Anna works for Harbourlight, so the server refuses ("Access denied").
4. Click **Return key**, take **Rob's** key, open the report from the in-tray and click **Stamp approved**.
5. Click **Open the raw data →** to see the sample CSV row by row and check that all 8 figures match the report.
6. Back on the report, download it as HTML, CSV or JSON. Before approval these buttons are locked.

### Other commands

```bash
python3 cli.py demo                         # runs the whole flow for both hotels and saves files to exports/
python3 -m unittest discover -s tests -v    # runs the 38 automated tests
python3 cli.py --help                       # every command-line option
```

---

## How it works

```
 Analyst                                          Reviewer (same hotel, a different person)
 ───────                                          ────────
 ① Upload CSV ──▶ every row checked ──▶ saved in that hotel's own database
 ② Build the report for a month
        │  numbers worked out ─▶ added up a second way ─▶ summary written from those numbers
        ▼
    [draft] ──③ Submit──▶ [waiting for review] ──Approve──▶ [approved] ──④ Download HTML / CSV / JSON
                                   │
                                   └──Send back (a note is required)──▶ [returned] ─▶ analyst builds it again
```

1. **Upload.** Choose a CSV, or click *Use the sample ledger*. Each sample file has 3 deliberately broken rows
   (an impossible date, a negative number of likes, more people reached than times seen). Those rows are turned
   away with their line number and the reason; the good rows are saved. Uploading the same file twice does no harm.
2. **Build the report.** Pick a month. The report compares it with the month before, using charts, a written
   summary and **five accuracy checks**.
3. **Review.** The analyst submits it. A **reviewer** from the same hotel approves it, or sends it back with a note.
   Every step is written to the hotel's activity log.
4. **Download.** Only an approved report can be downloaded: as a print-ready web page (use the browser's
   *Print → Save as PDF* for a PDF), a spreadsheet (CSV) or a data file (JSON). Copies are also saved in
   `exports/<hotel>/`.

### The website pages

The website only shows what the server sends it. It never works out numbers or decides who may see what.
If you try to open the other hotel, the server says no (error 403) and the page shows an "Access denied" stamp.

| Page | Address | What you can do there |
|---|---|---|
| Front desk | `/` | Sign in by taking a key |
| Hotel desk | `/hotels/{hotel}` | Upload data, see which rows were turned away, build a report |
| Report | `/reports/{hotel}/{id}` | Read the report, submit / approve / send back, download copies |
| In-tray | `/review` | Reviewers see reports waiting for them |
| Raw data | `/data/{hotel}` | See the sample CSV row by row, and recount it against the report |
| Audit log | `/audit` | Every sign-in, upload, report, approval, refusal and download |

---

## What the report shows

The report is written for a hotel manager, not a social-media expert. It starts with the story, and the details follow:

- **Verdict and headline:** for example *Strong period: "Engagements up 9.9%, 367 bookings from social (+14.3%)
  and +2,585 new followers."*
- **Scoreboard:** six key figures, each next to last month's.
- **Day by day:** this month against last month, for people reached, interactions, website clicks and bookings.
- **From seen to booked:** how many people saw the posts, reached the website and finally booked, for example
  "1 booking for every 22 website clicks".
- **Platforms:** which platform brings the audience and which brings the bookings, compared side by side.
- **Followers, best day of the week, best week.**
- **What it means:** wins, things to watch, and up to three suggested next steps.
- **The five checks** and the approval record.

Every sentence is produced by fixed rules (`insights()` in `hotelreports/report.py`) from numbers already in
the report. Nothing is free-written, so the words can never disagree with the figures. A change under 2% is
described as "about the same".

---

## How the main requirements are met

### Accurate numbers
All figures are worked out in one place, `hotelreports/metrics.py`:

- **interactions (engagements)** = likes + comments + shares + saves
- **engagement rate** = interactions ÷ people reached
- **click-through rate** = website clicks ÷ times seen
- **follower growth** = followers on the last day − followers on the first day (follower counts are never added up across days)
- anything divided by zero is shown as `n/a`

Before a report can be submitted, **five checks** run:

1. The totals are added up again directly in the database and must match exactly.
2. The platform figures must add up to the overall totals.
3. The engagement rate is worked out again from its parts.
4. The daily figures must add up to the monthly totals.
5. Any missing days are flagged.

If any of checks 1–4 fails, the report **cannot be submitted**. Missing days (check 5) are only a warning for the reviewer.

The comparison with last month is only shown when last month has complete data, so it never shows a misleading percentage.

Each report gets a **fingerprint** (a SHA-256 hash of its contents) when it is built. The fingerprint is checked again
when the report is approved and when it is downloaded, so any change made after review is caught.

### Keeping the hotels apart
| Where | How |
|---|---|
| Storage | Each hotel has its own database file (`data/tenants/<hotel>.db`), labelled with the hotel's ID. A file that has been swapped or copied is refused. |
| Code | Every database object (`TenantRepository`) is tied to one hotel when it's created, so no code can read two hotels at once. |
| Sign-in | Every user belongs to exactly one hotel. `tenancy.repo_for()` is the only way from a user to data, and it refuses (403) any other hotel. An unknown hotel gets the same answer, so nobody can guess which hotels exist. |
| Web addresses | Every address is `/api/clients/{hotel}/…`. The list of hotels only ever shows your own. |
| Uploads | A file containing rows for another hotel is **turned away entirely**, and the attempt is logged. An example is in `data/samples/misrouted/`. |
| Downloads | Files are saved to `exports/<hotel>/`, after checking the report really belongs to that hotel. |
| Tests | `tests/test_isolation.py` and `tests/test_api.py` try to cross between hotels and expect every attempt to be refused. |

A refused attempt is written to the log of the user's **own** hotel, never to the other hotel's.

### Check it yourself
The **Raw data** page lists every row of the hotel's sample CSV. Rows the server turned away are crossed out with
the reason. Your browser then adds up the accepted rows for the report's month in a simple loop of its own, and
puts each total next to the report's figure: rows used, times seen, people reached, interactions, clicks, posts,
bookings and follower growth. For the demo data all 8 match. (This recount is only for you to compare; the report
never uses it.)

### Human approval
- **Analysts** upload, build and submit reports. **Reviewers** approve them or send them back.
- Nobody can approve their own report. Sending one back requires a note. Only a report that is waiting for review can be decided.
- The activity log can only be added to, never edited. It records who did what and when.
- Downloading before approval is impossible (error 409). Before approval there is only a preview marked
  *DRAFT*, and it is never saved to `exports/`.

---

## Using the server directly (API)

You can sign in with `POST /api/login`, or send one of the demo keys in an `X-API-Key` header. The keys are in
`hotelreports/config.py`: `hl-analyst-demo-key`, `hl-reviewer-demo-key`, `pc-analyst-demo-key`, `pc-reviewer-demo-key`.

| Request | Who | What it does |
|---|---|---|
| `POST /api/login` `{username,password}` · `POST /api/logout` · `GET /api/me` | anyone | sign in / out, who am I |
| `GET /api/clients` | anyone | your own hotel only |
| `GET /api/clients/{id}` | hotel staff | overview: dates covered, number of reports |
| `POST /api/clients/{id}/imports` (CSV or JSON list; header `X-Filename`) | analyst | upload data |
| `POST /api/clients/{id}/imports/sample` | analyst | upload the hotel's sample file |
| `GET /api/clients/{id}/imports` | hotel staff | past uploads, with the rows turned away |
| `GET /api/clients/{id}/imports/sample.csv` | hotel staff | download the sample file |
| `GET /api/clients/{id}/imports/sample/preview` | hotel staff | the sample file row by row, each marked accepted or turned away with the reason (nothing is saved) |
| `GET /api/clients/{id}/metrics?start=&end=` | hotel staff | the stored rows (with no dates: the range available) |
| `POST /api/clients/{id}/reports` `{period_start, period_end}` | analyst | build a draft report |
| `GET /api/clients/{id}/reports[/{rid}]` | hotel staff | list of reports / one report with its history |
| `POST /api/clients/{id}/reports/{rid}/submit` | analyst | send for review |
| `POST /api/clients/{id}/reports/{rid}/approve` `{comment}` | reviewer | approve |
| `POST /api/clients/{id}/reports/{rid}/reject` `{comment}` | reviewer | send back |
| `GET /api/clients/{id}/reports/{rid}/export?format=html\|csv\|json` | hotel staff | download (approved only; `&preview=1` gives the DRAFT preview) |
| `GET /api/clients/{id}/audit` | hotel staff | the hotel's activity log |

Error codes: 400 bad input · 401 not signed in · **403 other hotel or wrong role** · 404 not found ·
**409 not allowed yet** (for example, downloading before approval).

```bash
K='X-API-Key: hl-analyst-demo-key'; R='X-API-Key: hl-reviewer-demo-key'; U=http://127.0.0.1:8000/api/clients
curl -s -X POST -H "$K" $U/harbourlight/imports/sample
curl -s -X POST -H "$K" -H 'Content-Type: text/csv' -H 'X-Filename: oct.csv' \
     --data-binary @data/samples/harbourlight/metrics.csv $U/harbourlight/imports
curl -s -X POST -H "$K" -H 'Content-Type: application/json' \
     -d '{"period_start":"2026-10-01","period_end":"2026-10-31"}' $U/harbourlight/reports
curl -s -X POST -H "$K" -d '{}' $U/harbourlight/reports/1/submit
curl -s -X POST -H "$R" -d '{"comment":"OK to send"}' $U/harbourlight/reports/1/approve
curl -s -H "$R" "$U/harbourlight/reports/1/export?format=csv" -o report.csv
curl -s -H "$K" $U/pinecrest/reports          # -> 403 Access denied
```

### CSV format
One row per **day per platform**, with these columns:
`date` (YYYY-MM-DD), `platform` (instagram, facebook or tiktok), `followers`, `impressions`, `reach`,
`likes`, `comments`, `shares`, `saves`, `link_clicks`, `posts`, `website_bookings_attributed`,
and an optional `client_id`, which must match the hotel if it's there.

A row is turned away if a number is negative or not whole, if reach, interactions or clicks are higher than
impressions, or if the same date and platform appear twice in one file.

---

## Project layout

```
app.py                 starts the web server (website + API)
cli.py                 command line: generate-data, reset, demo, import, report, submit, approve, reject, export, list
hotelreports/
  config.py            file paths, the two hotels, demo users and keys
  synthetic.py         makes the sample data (same numbers every time, 3 bad rows per hotel, one misrouted file)
  storage.py           one database per hotel
  tenancy.py           sign-in, sessions, keys, and the check that keeps hotels apart
  importer.py          checks and saves uploaded rows
  metrics.py           all the maths
  report.py            builds the report, runs the five checks, writes the summary, makes the fingerprint
  workflow.py          draft → review → approved / returned, and the activity log
  exporters.py         HTML / CSV / JSON downloads (approved reports only)
  server.py            the web server and API
frontend/              the Night Audit website (React); dist/ is the built copy served at /
  src/lib/audit/api.ts the only file that talks to the server
web/index.html         the older single-page website, served at /classic
data/samples/          sample CSV files          data/tenants/   the hotel databases (created when it runs)
exports/<hotel>/       downloaded reports        tests/          automated tests
Demo_video.mov         the recorded demo video
```

---

## Working on the code

- **The website:**
  ```bash
  cd frontend && npm install
  npm run dev        # http://localhost:5173 (start python3 app.py first; /api calls are passed to it)
  npm run build      # rebuilds frontend/dist/, which app.py serves
  npm test           # quick page tests
  ```
  `src/routeTree.gen.ts` is generated by the build, so don't edit it by hand.
- **Ground rules** that keep the reports trustworthy:
  - The server uses the Python standard library only.
  - Never read two hotels' data in one place. Every new hotel route starts with `tenancy.repo_for(user, hotel)`.
  - Every number in a report comes from `metrics.py`. The written summary only repeats those numbers.
  - The website shows what the server returns. It never works out report numbers or decides access.
- After any change, run the tests. If the number of tests changes, update it in this README,
  `frontend/src/components/desk/Shell.tsx` and `frontend/src/routes/index.tsx`, then run `npm run build`.

### Design decisions
- **No AI-written text in reports.** The summary is built from fixed rules so every sentence can be traced to a number.
- **One database file per hotel**, rather than one shared database, so a mistake in the code can't mix two hotels up.
- **A misrouted file is turned away whole**, not row by row. If one row belongs to another hotel, the whole file is suspect.
- **Follower growth is last day minus first day**, because follower counts are snapshots, not daily amounts.
- **Missing days are a warning, wrong totals are a stop.** Gaps happen in real data; a total that doesn't add up never should.
- **Platform colours** (Instagram blue, Facebook orange, TikTok green) were chosen to stay distinguishable for colour-blind
  readers, and every bar or line is also labelled with its name.
- **The website is a plain single-page app**, so Python stays the only server.
- **`cli.py reset`** leaves Harbourlight empty and Pinecrest with an approved October report, ready for the demo video.

---

## Limits of this prototype
- The data is made up and both hotels are fictional. Nothing is connected to the real social platforms.
- "Bookings from social" is taken as given in the data; working out where bookings came from is out of scope.
- The demo users share one password, and sign-ins are kept in memory (restarting the server signs everyone out).
  There's no HTTPS: it is meant to run on your own computer.
- PDFs come from printing the HTML report in the browser, to avoid extra packages.
- Python's built-in web server and SQLite are fine for a demo, not for heavy use.

## Possible next steps
Connect to the real platforms (Meta and TikTok business APIs) on a schedule · move to a production database ·
company single sign-on and proper user management · PDF files and emailing approved reports · let reviewers
comment on individual numbers.
