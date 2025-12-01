// src/scan.js
// Scans every org where your GitHub App is installed and writes dashboard/data.json
// Includes build status of tags (from 'tags' or 'releases'), with prefix/regex filtering.

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { paginateRest } from "@octokit/plugin-paginate-rest";
import { restEndpointMethods } from "@octokit/plugin-rest-endpoint-methods";
import fs from "node:fs";
import path from "node:path";

const PaginatingOctokit = Octokit.plugin(paginateRest, restEndpointMethods);

const APP_ID = process.env.APP_ID;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RUN_WINDOW_DAYS = parseInt(process.env.SCANNED_RUN_WINDOW_DAYS || "14", 10);
const MAX_REPOS = process.env.MAX_REPOS ? parseInt(process.env.MAX_REPOS, 10) : null;

// Tag options
const TAG_SOURCE = (process.env.TAG_SOURCE || "tags").toLowerCase(); // "tags" | "releases"
const TAG_PREFIXES = (process.env.TAG_PREFIXES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TAG_REGEX = process.env.TAG_REGEX ? new RegExp(process.env.TAG_REGEX) : null;
const TAG_INCLUDE_PRERELEASES = String(process.env.TAG_INCLUDE_PRERELEASES || "false") === "true";
const TAGS_LIMIT = parseInt(process.env.TAGS_LIMIT || "5", 10);

if (!APP_ID || !PRIVATE_KEY) {
  console.error("Missing APP_ID or PRIVATE_KEY env vars");
  process.exit(1);
}

const appOctokit = new PaginatingOctokit({
  authStrategy: createAppAuth,
  auth: { appId: APP_ID, privateKey: PRIVATE_KEY },
  request: { retries: 2 },
});

const cutoff = new Date(Date.now() - RUN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getInstallations() {
  return appOctokit.paginate("GET /app/installations", { per_page: 100 });
}

function installationClient(installationId) {
  return new PaginatingOctokit({
    authStrategy: createAppAuth,
    auth: { appId: APP_ID, privateKey: PRIVATE_KEY, installationId },
    request: { retries: 2 },
  });
}

// Manual pagination & normalization
async function listRepos(instOctokit) {
  let page = 1;
  const repos = [];
  while (true) {
    const resp = await instOctokit.request("GET /installation/repositories", {
      per_page: 100,
      page,
    });
    const items = resp?.data?.repositories || [];
    for (const r of items) {
      repos.push({
        id: r?.id ?? null,
        name: r?.name ?? null,
        full_name:
          r?.full_name ??
          (r?.owner?.login && r?.name ? `${r.owner.login}/${r.name}` : null),
        owner: { login: r?.owner?.login ?? null },
        private: !!r?.private,
        archived: !!r?.archived,
        default_branch: r?.default_branch ?? null,
        html_url: r?.html_url ?? null,
        pushed_at: r?.pushed_at ?? null,
      });
    }
    const link = resp?.headers?.link || "";
    const hasNext = /<[^>]+>; rel="next"/.test(link);
    if (!hasNext || items.length === 0) break;
    page++;
    await sleep(50);
  }
  return repos;
}

// ---------- Tag/release helpers ----------
function namePassesFilters(name) {
  if (!name) return false;
  if (TAG_PREFIXES.length && !TAG_PREFIXES.some((p) => name.startsWith(p))) return false;
  if (TAG_REGEX && !TAG_REGEX.test(name)) return false;
  return true;
}

// Returns array of { name, refForChecks, html_url }
async function listTagRefs(octokit, repo, limit = TAGS_LIMIT) {
  const out = [];

  if (TAG_SOURCE === "releases") {
    let page = 1;
    while (out.length < limit) {
      const r = await octokit.request("GET /repos/{owner}/{repo}/releases", {
        owner: repo.owner.login,
        repo: repo.name,
        per_page: 100,
        page,
      });
      const releases = r?.data || [];
      if (!releases.length) break;

      for (const rel of releases) {
        if (!TAG_INCLUDE_PRERELEASES && (rel?.prerelease || rel?.draft)) continue;
        const tagName = rel?.tag_name;
        if (!namePassesFilters(tagName)) continue;

        out.push({
          name: tagName,
          refForChecks: tagName, // Checks API accepts tag refs
          html_url: rel?.html_url || (repo.html_url ? `${repo.html_url}/releases/tag/${encodeURIComponent(tagName)}` : null),
        });
        if (out.length >= limit) break;
      }
      const link = r?.headers?.link || "";
      const hasNext = /<[^>]+>; rel="next"/.test(link);
      if (!hasNext) break;
      page++;
      await sleep(40);
    }
  } else {
    // TAG_SOURCE === "tags"
    let page = 1;
    while (out.length < limit) {
      const r = await octokit.request("GET /repos/{owner}/{repo}/tags", {
        owner: repo.owner.login,
        repo: repo.name,
        per_page: 100,
        page,
      });
      const tags = r?.data || [];
      if (!tags.length) break;

      for (const t of tags) {
        const tagName = t?.name;
        if (!namePassesFilters(tagName)) continue;

        out.push({
          name: tagName,
          refForChecks: tagName, // use tag name as ref
          html_url: repo.html_url ? `${repo.html_url}/tree/${encodeURIComponent(tagName)}` : null,
        });
        if (out.length >= limit) break;
      }
      const link = r?.headers?.link || "";
      const hasNext = /<[^>]+>; rel="next"/.test(link);
      if (!hasNext) break;
      page++;
      await sleep(40);
    }
  }

  return out.slice(0, limit);
}

async function concludeForRef(octokit, repo, ref) {
  // Prefer suites aggregate
  const suitesResp = await octokit.request(
    "GET /repos/{owner}/{repo}/commits/{ref}/check-suites",
    { owner: repo.owner.login, repo: repo.name, ref, per_page: 100 }
  );
  const suites = suitesResp?.data?.check_suites || [];
  if (suites.length) {
    if (suites.some((s) => ["failure", "cancelled", "timed_out"].includes(s?.conclusion || "")))
      return "failure";
    if (suites.every((s) => s?.conclusion === "success")) return "success";
    if (suites.some((s) => (s?.status || "") !== "completed" && !s?.conclusion)) return "in_progress";
    return suites[0]?.conclusion || "unknown";
  }

  // Fallback: runs
  const runsResp = await octokit.request(
    "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
    { owner: repo.owner.login, repo: repo.name, ref, per_page: 100 }
  );
  const runs = runsResp?.data?.check_runs || [];
  if (runs.length) {
    if (runs.some((r) => ["failure", "cancelled", "timed_out"].includes(r?.conclusion || "")))
      return "failure";
    if (runs.every((r) => r?.conclusion === "success")) return "success";
    if (runs.some((r) => (r?.status || "") !== "completed" && !r?.conclusion)) return "in_progress";
    return runs[0]?.conclusion || "unknown";
  }

  return "unknown";
}

async function fetchTagStatuses(octokit, repo, limit = TAGS_LIMIT) {
  try {
    const refs = await listTagRefs(octokit, repo, limit);
    const out = [];
    for (const ref of refs) {
      const conclusion = await concludeForRef(octokit, repo, ref.refForChecks);
      out.push({
        name: ref.name,
        sha: null, // not required; we used ref
        conclusion,
        html_url: ref.html_url,
      });
      await sleep(25);
    }
    return out;
  } catch (e) {
    return [{ name: null, sha: null, conclusion: "unknown", error: String(e?.message || e) }];
  }
}

// ---------- Workflows / repo health ----------
async function fetchRepoHealth(octokit, repo) {
  if (!repo || !repo.owner?.login || !repo.name) {
    return {
      id: repo?.id ?? null,
      name: repo?.name ?? null,
      full_name: repo?.full_name ?? null,
      error: "Malformed repository object (missing owner/name)",
    };
  }

  const paramsBase = { owner: repo.owner.login, repo: repo.name, per_page: 50 };

  const [runsCompleted, runsInProgress, runsQueued] = await Promise.all([
    octokit.request("GET /repos/{owner}/{repo}/actions/runs", {
      ...paramsBase,
      status: "completed",
    }),
    octokit.request("GET /repos/{owner}/{repo}/actions/runs", {
      ...paramsBase,
      status: "in_progress",
    }),
    octokit.request("GET /repos/{owner}/{repo}/actions/runs", {
      ...paramsBase,
      status: "queued",
    }),
  ]);

  const recent = (runsResp) => {
    const list = runsResp?.data?.workflow_runs || [];
    return list.filter((r) => r && r.created_at && new Date(r.created_at) >= cutoff);
  };

  const completed = recent(runsCompleted);
  const inProgress = recent(runsInProgress);
  const queued = recent(runsQueued);

  // Latest completed run per workflow
  const byWorkflow = new Map();
  for (const run of completed) {
    if (!run || !run.workflow_id) continue;
    const prev = byWorkflow.get(run.workflow_id);
    if (!prev || new Date(run.created_at) > new Date(prev.created_at)) {
      byWorkflow.set(run.workflow_id, run);
    }
  }

  async function failingJobs(latestRun) {
    if (!latestRun || !latestRun.id) return [];
    const jobs = await octokit.paginate(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs",
      { owner: repo.owner.login, repo: repo.name, run_id: latestRun.id, per_page: 100 },
      (resp) => resp?.data?.jobs || []
    );
    return (jobs || [])
      .filter((j) => ["failure", "cancelled", "timed_out"].includes(j?.conclusion || ""))
      .map((j) => ({
        id: j?.id ?? null,
        name: j?.name ?? null,
        html_url: j?.html_url ?? null,
        conclusion: j?.conclusion ?? null,
        started_at: j?.started_at ?? null,
        completed_at: j?.completed_at ?? null,
        duration_ms:
          j?.completed_at && j?.started_at
            ? new Date(j.completed_at) - new Date(j.started_at)
            : null,
      }));
  }

  const workflows = [];
  for (const run of byWorkflow.values()) {
    if (!run) continue;
    const conclusion = run?.conclusion || "";
    const isBad = ["failure", "cancelled", "timed_out"].includes(conclusion);
    workflows.push({
      workflow_id: run.workflow_id,
      workflow_name: run.name || String(run.workflow_id),
      latest_run: {
        id: run.id ?? null,
        event: run.event ?? null,
        html_url: run.html_url ?? null,
        status: run.status ?? null,
        conclusion: run.conclusion ?? null,
        created_at: run.created_at ?? null,
        updated_at: run.updated_at ?? null,
        head_branch: run.head_branch ?? null,
        head_sha: run.head_sha ?? null,
      },
      failing_jobs: isBad ? await failingJobs(run) : [],
    });
    if (isBad) await sleep(60);
  }

  const lastSuccess =
    (completed || [])
      .filter((r) => r && r.conclusion === "success")
      .sort(
        (a, b) => new Date(b.created_at).valueOf() - new Date(a.created_at).valueOf()
      )[0]?.created_at || null;

  // Tag/release statuses
  const tags = await fetchTagStatuses(octokit, repo, TAGS_LIMIT);

  return {
    id: repo.id ?? null,
    name: repo.name ?? null,
    full_name:
      repo.full_name ??
      (repo.owner?.login && repo.name ? `${repo.owner.login}/${repo.name}` : null),
    private: !!repo.private,
    archived: !!repo.archived,
    default_branch: repo.default_branch ?? null,
    html_url: repo.html_url ?? null,
    pushed_at: repo.pushed_at ?? null,
    last_success: lastSuccess,
    workflows,
    tags,
    in_progress: inProgress.length,
    queued: queued.length,
  };
}

async function main() {
  const outDir = path.join(process.cwd(), "dashboard");
  fs.mkdirSync(outDir, { recursive: true });

  const installations = await getInstallations();
  console.log(`Found ${installations.length} installations`);

  const orgs = [];
  let repoCounter = 0;

  for (const inst of installations) {
    const instClient = installationClient(inst.id);
    const repos = await listRepos(instClient);
    console.log(`Installation ${inst.account?.login} → ${repos.length} repos`);

    const reposOut = [];

    for (const r of repos) {
      if (MAX_REPOS && repoCounter >= MAX_REPOS) break;
      repoCounter++;
      try {
        const health = await fetchRepoHealth(instClient, r);
        reposOut.push(health);
      } catch (e) {
        const display =
          r?.full_name ??
          (r?.owner?.login && r?.name ? `${r.owner.login}/${r.name}` : r?.name ?? "(unknown repo)");
        console.warn(`Repo scan failed: ${display}`, e?.status || e?.message || e);
        reposOut.push({
          id: r?.id ?? null,
          name: r?.name ?? null,
          full_name:
            r?.full_name ??
            (r?.owner?.login && r?.name ? `${r.owner.login}/${r.name}` : null),
          error: String(e?.message || e),
        });
      }
      await sleep(40);
    }

    orgs.push({
      installation_id: inst.id,
      account_login: inst.account?.login ?? null,
      account_type: inst.account?.type ?? null,
      html_url: inst.account?.html_url ?? null,
      repositories: reposOut,
    });
  }

  const payload = {
    generated_at: new Date().toISOString(),
    run_window_days: RUN_WINDOW_DAYS,
    org_count: orgs.length,
    repo_count: orgs.reduce((n, o) => n + o.repositories.length, 0),
    orgs,
  };

  fs.writeFileSync(path.join(outDir, "data.json"), JSON.stringify(payload, null, 2));
  console.log("Wrote dashboard/data.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});