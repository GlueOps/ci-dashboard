# ci-dashboard

## Step 1 — Create a GitHub App
On https://github.com Go to: 

Settings → Developer settings → GitHub Apps → New GitHub App

Give it a name like ci-health-dashboard, and configure:

Permissions (minimum):

Repository → Actions → Read-only
Repository → Checks → Read-only
Repository → Contents → Read-only
Repository → Metadata → Read-only

Where can this GitHub App be installed?

Choose Any account

Save it, then generate:

A Private key (.pem) — download this file.
Copy the App ID.

Install the app on any orgs you want scanned (you can add more later)

## Step 2 - Clone this repo

```bash
git clone git@github.com:glueops/ci-dashboard.git
```

## Step 3 — GitHub Action to scan and publish
Rename `.github/workflows/scan-and-publish.txt` to `.github/workflows/scan-and-publish.yml`

Then add two secrets in your repo’s Settings → Secrets → Actions:

APP_ID (The APP_ID from the created app)
PRIVATE_KEY (paste the .pem contents)

## Step 4 — The dashboard
Every 6 hours (or on manual trigger), the workflow runs your app, scans all installations, collects:

- Repo list
- Workflow runs (success/failure/cancelled)
- Failing jobs
- In-progress / queued counts
- Tag / release build statuses

Then it writes to dashboard/data.json and renders dashboard/index.html.

The index.html includes:

Filters for text, status, tag name, tag status
URL parameters (?q=&filter=&tag=&tagstatus=) so you can share filtered views
A dark theme grid with colored pills and tags for quick health scanning

It’s completely static — no backend required.

## 🪄 Step 5 — Publish to Pages
Go to your repo’s Settings → Pages, set:

Source: “GitHub Actions”
Branch: leave blank (Actions handles it)

After your first successful workflow run, your dashboard will appear at:

https://<username>.github.io/<reponame>/

You can bookmark it or share filtered views, like:

?filter=failing&tag=v1
