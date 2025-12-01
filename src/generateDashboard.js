// src/generateDashboard.js
// Renders dashboard/index.html with filtering by tag/name/status
// and supports URL query params: ?q=&filter=&tag=&tagstatus=
// (keeps URL updated on input changes)

import fs from "node:fs";
import path from "node:path";

function page() {
  return (
"<!doctype html>\n"+
"<html lang=\"en\">\n"+
"  <head>\n"+
"    <meta charset=\"utf-8\" />\n"+
"    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n"+
"    <title>CI Health Dashboard</title>\n"+
"    <style>\n"+
"      :root { --bg:#0b1020; --card:#111936; --muted:#8aa0b6; --ok:#2ecc71; --bad:#ff6b6b; --warn:#f1c40f; }\n"+
"      *{box-sizing:border-box}\n"+
"      body{margin:0;background:var(--bg);color:#e9f0f6;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Helvetica,Arial}\n"+
"      header{padding:20px 24px;border-bottom:1px solid #25314d;display:flex;gap:12px;align-items:center;flex-wrap:wrap}\n"+
"      h1{margin:0;font-size:20px}\n"+
"      .muted{color:var(--muted)}\n"+
"      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px;padding:16px}\n"+
"      .card{background:var(--card);border-radius:12px;padding:14px;border:1px solid #25314d}\n"+
"      .row{display:flex;justify-content:space-between;gap:8px;align-items:center}\n"+
"      input,select{background:#0e1530;color:#dce6f3;border:1px solid #28365b;border-radius:8px;padding:10px}\n"+
"      a{color:#8ab4ff;text-decoration:none}\n"+
"      .pill{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid #2b3e6b;white-space:nowrap}\n"+
"      .ok{background:#13341f;border-color:#1e7f4d}\n"+
"      .bad{background:#3a1212;border-color:#9b2a2a}\n"+
"      .warn{background:#3a300e;border-color:#7a6613}\n"+
"      .tagbar{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}\n"+
"      .tag{border:1px solid #2b3e6b;border-radius:10px;padding:2px 8px;font-size:12px;display:inline-flex;gap:6px;align-items:center}\n"+
"      .dot{width:8px;height:8px;border-radius:999px;display:inline-block}\n"+
"      .dot.ok{background:var(--ok)} .dot.bad{background:var(--bad)} .dot.warn{background:var(--warn)} .dot.unk{background:#7a8aa3}\n"+
"      table{width:100%;border-collapse:collapse;margin-top:10px}\n"+
"      th,td{padding:6px 8px;border-bottom:1px solid #25314d;vertical-align:top}\n"+
"      th{text-align:left}\n"+
"      footer{color:#8aa0b6;padding:12px 16px;border-top:1px solid #25314d}\n"+
"      .section{padding:0 16px}\n"+
"      details{margin:8px 0}\n"+
"      summary{cursor:pointer}\n"+
"      .err{color:#ffb3b3}\n"+
"      .controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center}\n"+
"      .controls label{font-size:12px;color:var(--muted)}\n"+
"    </style>\n"+
"  </head>\n"+
"  <body>\n"+
"    <header>\n"+
"      <h1>CI Health Dashboard</h1>\n"+
"      <div class=\"muted\" id=\"generated\"></div>\n"+
"      <div style=\"flex:1\"></div>\n"+
"      <div class=\"controls\">\n"+
"        <input id=\"q\" placeholder=\"Search repo/workflow…\" />\n"+
"        <select id=\"filter\">\n"+
"          <option value=\"all\">All</option>\n"+
"          <option value=\"failing\">Has failing runs</option>\n"+
"          <option value=\"stale\">No success in window</option>\n"+
"        </select>\n"+
"        <input id=\"tagq\" placeholder=\"Tag contains…\" />\n"+
"        <select id=\"tagstatus\">\n"+
"          <option value=\"any\">Any tag status</option>\n"+
"          <option value=\"success\">Tag status: success</option>\n"+
"          <option value=\"failure\">Tag status: failure</option>\n"+
"          <option value=\"in_progress\">Tag status: in progress</option>\n"+
"          <option value=\"unknown\">Tag status: unknown</option>\n"+
"          <option value=\"has\">Has tags</option>\n"+
"          <option value=\"none\">No tags</option>\n"+
"        </select>\n"+
"      </div>\n"+
"    </header>\n"+
"\n"+
"    <div class=\"section\">\n"+
"      <details id=\"errors-wrap\" open style=\"display:none\">\n"+
"        <summary>Scan errors</summary>\n"+
"        <ul id=\"errors\"></ul>\n"+
"      </details>\n"+
"    </div>\n"+
"\n"+
"    <div class=\"grid\" id=\"grid\"></div>\n"+
"\n"+
"    <footer>\n"+
"      Built from GitHub Actions data. Latest file: <code>dashboard/data.json</code>.\n"+
"    </footer>\n"+
"\n"+
"    <script>\n"+
"      (function(){\n"+
"        function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }\n"+
"        function pill(cls, txt){ return '<span class=\"pill '+cls+'\">'+esc(txt)+'</span>'; }\n"+
"        function dot(cl){ return '<span class=\"dot '+cl+'\"></span>'; }\n"+
"        function tagBadge(tag){\n"+
"          var c = (tag && tag.conclusion) || 'unknown';\n"+
"          var cls = c==='success' ? 'ok' : (c==='failure' ? 'bad' : (c==='in_progress' ? 'warn' : 'unk'));\n"+
"          var name = esc(tag && tag.name || '(tag)');\n"+
"          var href = esc(tag && tag.html_url || '#');\n"+
"          return '<a class=\"tag\" target=\"_blank\" href=\"'+href+'\">'+dot(cls)+'<span>'+name+'</span></a>';\n"+
"        }\n"+
"\n"+
"        // --- URL state helpers ---\n"+
"        function readParams(){\n"+
"          var u = new URL(window.location.href);\n"+
"          return {\n"+
"            q: u.searchParams.get('q') || '',\n"+
"            filter: u.searchParams.get('filter') || 'all',\n"+
"            tag: u.searchParams.get('tag') || '',\n"+
"            tagstatus: u.searchParams.get('tagstatus') || 'any'\n"+
"          };\n"+
"        }\n"+
"        function writeParams(state){\n"+
"          var u = new URL(window.location.href);\n"+
"          var sp = u.searchParams;\n"+
"          function setOrDel(key, val, def){ if(!val || val===def){ sp.delete(key); } else { sp.set(key, val); } }\n"+
"          setOrDel('q', state.q, '');\n"+
"          setOrDel('filter', state.filter, 'all');\n"+
"          setOrDel('tag', state.tag, '');\n"+
"          setOrDel('tagstatus', state.tagstatus, 'any');\n"+
"          var qs = sp.toString();\n"+
"          var newUrl = u.pathname + (qs ? ('?'+qs) : '') + u.hash;\n"+
"          if (newUrl !== window.location.pathname + window.location.search + window.location.hash) {\n"+
"            history.replaceState(null, '', newUrl);\n"+
"          }\n"+
"        }\n"+
"        function debounce(fn, ms){ var t; return function(){ var a=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(null,a); }, ms); }; }\n"+
"\n"+
"        function matchesFreeText(repo, term){\n"+
"          if(!term) return true;\n"+
"          var hay=(repo.full_name+' '+(repo.workflows||[]).map(function(w){return w.workflow_name;}).join(' ')).toLowerCase();\n"+
"          return hay.indexOf(term.toLowerCase())>-1;\n"+
"        }\n"+
"        function repoFailing(repo){\n"+
"          return (repo.workflows||[]).some(function(w){ var c=(w.latest_run&&w.latest_run.conclusion)||''; return ['failure','cancelled','timed_out'].indexOf(c)>-1; });\n"+
"        }\n"+
"        function repoStale(repo){ return !repo.last_success; }\n"+
"        function matchesTagName(repo, term){ if(!term) return true; term=term.toLowerCase(); return (repo.tags||[]).some(function(t){ return t && t.name && t.name.toLowerCase().indexOf(term)>-1; }); }\n"+
"        function matchesTagStatus(repo, mode){ var tags=repo.tags||[]; if(mode==='any') return true; if(mode==='has') return tags.length>0; if(mode==='none') return tags.length===0; return tags.some(function(t){ return (t && (t.conclusion||'unknown')===mode); }); }\n"+
"\n"+
"        function cardHtml(repo){\n"+
"          var problems = repoFailing(repo);\n"+
"          var inprog = repo.in_progress||0;\n"+
"          var queued = repo.queued||0;\n"+
"          var html='';\n"+
"          html += \"<div class='card'>\";\n"+
"          html +=   \"<div class='row'>\";\n"+
"          html +=     \"<div>\"+'<a target=\"_blank\" href=\"'+esc(repo.html_url)+'\">'+esc(repo.full_name)+'</a>'+(repo.archived?' '+pill('warn','archived'):'')+\"</div>\";\n"+
"          html +=     \"<div>\"+(problems?pill('bad','failing'):pill('ok','OK'))+(inprog?' '+pill('','in-progress '+inprog):'')+(queued?' '+pill('','queued '+queued):'')+\"</div>\";\n"+
"          html +=   \"</div>\";\n"+
"          if (repo.tags && repo.tags.length){ html += '<div class=\"tagbar\">'+repo.tags.map(tagBadge).join('')+'</div>'; }\n"+
"          html +=   \"<table><thead><tr><th>Workflow</th><th>Status</th><th>When</th></tr></thead><tbody>\";\n"+
"          (repo.workflows||[]).forEach(function(w){\n"+
"            var c=(w.latest_run&&w.latest_run.conclusion) || (w.latest_run&&w.latest_run.status) || 'unknown';\n"+
"            var cls=(['failure','cancelled','timed_out'].indexOf(c)>-1)?'bad':(c==='success'?'ok':'');\n"+
"            var when=(w.latest_run&&w.latest_run.created_at)? new Date(w.latest_run.created_at).toLocaleString() : '';\n"+
"            html += '<tr>'+\n"+
"                      '<td><a target=\"_blank\" href=\"'+esc(w.latest_run&&w.latest_run.html_url)+'\">'+esc(w.workflow_name || w.workflow_id)+'</a></td>'+\n"+
"                      '<td>'+pill(cls, c)+'</td>'+\n"+
"                      '<td class=\"muted\">'+esc(when)+'</td>'+\n"+
"                    '</tr>';\n"+
"            if (w.failing_jobs && w.failing_jobs.length){\n"+
"              html += '<tr><td colspan=\"3\"><div class=\"muted\">Failing jobs:</div><ul>'+\n"+
"                      w.failing_jobs.map(function(j){ return '<li><a target=\"_blank\" href=\"'+esc(j.html_url)+'\">'+esc(j.name)+'</a> ('+esc(j.conclusion)+')</li>'; }).join('')+\n"+
"                      '</ul></td></tr>';\n"+
"            }\n"+
"          });\n"+
"          html +=   \"</tbody></table>\";\n"+
"          html += \"</div>\";\n"+
"          return html;\n"+
"        }\n"+
"\n"+
"        function render(data){\n"+
"          var grid = document.getElementById('grid');\n"+
"          var q = document.getElementById('q');\n"+
"          var filter = document.getElementById('filter');\n"+
"          var tagq = document.getElementById('tagq');\n"+
"          var tagstatus = document.getElementById('tagstatus');\n"+
"          var state = { q: (q.value||'').trim(), filter: filter.value, tag: (tagq.value||'').trim(), tagstatus: tagstatus.value };\n"+
"\n"+
"          var frags = [];\n"+
"          data.orgs.forEach(function(org){\n"+
"            org.repositories.forEach(function(repo){\n"+
"              if (!repo || repo.error) return;\n"+
"              if (!matchesFreeText(repo, state.q)) return;\n"+
"              if (state.filter==='failing' && !repoFailing(repo)) return;\n"+
"              if (state.filter==='stale' && !repoStale(repo)) return;\n"+
"              if (!matchesTagName(repo, state.tag)) return;\n"+
"              if (!matchesTagStatus(repo, state.tagstatus)) return;\n"+
"              frags.push(cardHtml(repo));\n"+
"            });\n"+
"          });\n"+
"\n"+
"          grid.innerHTML = frags.join('') || '<div class=\"muted\">No repositories match your filters.</div>';\n"+
"          writeParams(state);\n"+
"        }\n"+
"\n"+
"        fetch('data.json', {cache:'no-store'})\n"+
"          .then(function(r){return r.json();})\n"+
"          .then(function(data){\n"+
"            document.getElementById('generated').textContent = 'Generated ' + new Date(data.generated_at).toLocaleString() + ' • Orgs: ' + data.org_count + ' • Repos: ' + data.repo_count;\n"+
"\n"+
"            // Errors list\n"+
"            var errorsWrap=document.getElementById('errors-wrap');\n"+
"            var errorsList=document.getElementById('errors');\n"+
"            var allErrors=[]; data.orgs.forEach(function(org){ org.repositories.forEach(function(repo){ if(repo && repo.error) allErrors.push(repo); }); });\n"+
"            if(allErrors.length){ errorsWrap.style.display=''; errorsList.innerHTML = allErrors.map(function(e){ return '<li class=\"err\">'+esc(e.full_name||e.name||'(unknown)')+': '+esc(e.error)+'</li>'; }).join(''); }\n"+
"\n"+
"            // Initialize controls from URL\n"+
"            var initial = readParams();\n"+
"            var q=document.getElementById('q'); var filter=document.getElementById('filter'); var tagq=document.getElementById('tagq'); var tagstatus=document.getElementById('tagstatus');\n"+
"            q.value = initial.q; filter.value = initial.filter; tagq.value = initial.tag; tagstatus.value = initial.tagstatus;\n"+
"\n"+
// debounced inputs
"            var debouncedRender = debounce(function(){ render(data); }, 200);\n"+
"            q.addEventListener('input', debouncedRender);\n"+
"            tagq.addEventListener('input', debouncedRender);\n"+
"            filter.addEventListener('change', function(){ render(data); });\n"+
"            tagstatus.addEventListener('change', function(){ render(data); });\n"+
"\n"+
"            render(data);\n"+
"          });\n"+
"      })();\n"+
"    </script>\n"+
"  </body>\n"+
"</html>\n"
  );
}

function main() {
  const outDir = path.join(process.cwd(), "dashboard");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), page());
  console.log("Wrote dashboard/index.html");
}

main();