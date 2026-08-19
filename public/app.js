// --- DOM refs -------------------------------------------------------------
const todayLabel = document.querySelector('#today-label');
const runAgentBtn = document.querySelector('#run-agent');
const pauseAgentBtn = document.querySelector('#pause-agent');
const agentPulse = document.querySelector('#agent-pulse');
const agentStatus = document.querySelector('#agent-status');

const metricNewRoles = document.querySelector('#metric-new-roles');
const metricStrongMatches = document.querySelector('#metric-strong-matches');
const metricApplicationsPrepared = document.querySelector('#metric-applications-prepared');
const nextScanTimeEl = document.querySelector('#next-scan-time');
const activeSourcesCountEl = document.querySelector('#active-sources-count');
const applicationsGoalLabel = document.querySelector('#applications-goal-label');
const activityHeading = document.querySelector('#activity-heading');
const activityChange = document.querySelector('#activity-change');
const activityAxis = document.querySelector('#activity-axis');
const activityBars = document.querySelector('#activity-bars');
const activityGoalFill = document.querySelector('#activity-goal-fill');

const matchesEl = document.querySelector('#matches');
const matchesTotal = document.querySelector('#matches-total');
const navMatchesCount = document.querySelector('#nav-matches-count');

const sourcesHeading = document.querySelector('#sources-heading');
const sourceList = document.querySelector('#source-list');
const addSourceBtn = document.querySelector('#add-source');

const documentList = document.querySelector('#document-list');
const documentsFolderPath = document.querySelector('#documents-folder-path');

const settingsSalaryMin = document.querySelector('#settings-salary-min');
const settingsSalaryMax = document.querySelector('#settings-salary-max');
const locationsEditor = document.querySelector('#locations-editor');
const locationsInput = document.querySelector('#locations-input');
const locationsAddBtn = document.querySelector('#locations-add');
const locationPresetsEl = document.querySelector('#location-presets');
const exclusionsEditor = document.querySelector('#exclusions-editor');
const exclusionsInput = document.querySelector('#exclusions-input');
const exclusionsAddBtn = document.querySelector('#exclusions-add');
const skillsEditor = document.querySelector('#skills-editor');
const skillsInput = document.querySelector('#skills-input');
const skillsAddBtn = document.querySelector('#skills-add');
const settingsSaveBtn = document.querySelector('#settings-save');
const settingsStatus = document.querySelector('#settings-status');
const notifyEnabledEl = document.querySelector('#notify-enabled');
const notifyThresholdEl = document.querySelector('#notify-threshold');
const notifyTestBtn = document.querySelector('#notify-test');
const notifyHint = document.querySelector('#notify-hint');
const skillTargetEl = document.querySelector('#skill-target');
const skillFamilyTargetEl = document.querySelector('#skill-family-target');
const distributionEl = document.querySelector('#distribution');

const profileName = document.querySelector('#profile-name');
const profileAvatar = document.querySelector('#profile-avatar');

const dialog = document.querySelector('#review-dialog');
const dialogTitle = document.querySelector('#dialog-title');
const dialogSummary = document.querySelector('#dialog-summary');
const dialogBullets = document.querySelector('#dialog-bullets');
const dialogRationale = document.querySelector('#dialog-rationale');
const dialogDownload = document.querySelector('#dialog-download');
const dialogPrimary = document.querySelector('#dialog-primary');
const closeDialogBtn = document.querySelector('#close-dialog');

let matchesById = new Map();
let sourcesCache = [];
let currentApplication = null;
let profileDraft = { salaryMin: null, salaryMax: null, locations: [], exclusions: [], skills: [], locationPresets: [] };

// --- API helpers ------------------------------------------------------------
async function safeErrorMessage(res) {
  try {
    const data = await res.json();
    return data.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await safeErrorMessage(res));
  return res.json();
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await safeErrorMessage(res));
  return res.json();
}

async function patchJSON(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await safeErrorMessage(res));
  return res.json();
}

// --- formatting helpers ------------------------------------------------------
function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

function parseSqliteUtc(value) {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatNextScan(raw) {
  const date = parseSqliteUtc(raw);
  if (!date) return 'No active sources';
  const diffMin = Math.round((date.getTime() - Date.now()) / 60000);
  if (diffMin <= 0) return 'Due now';
  if (diffMin < 60) return `In ${diffMin} minute${diffMin === 1 ? '' : 's'}`;
  const hours = Math.round(diffMin / 60);
  return `In ${hours} hour${hours === 1 ? '' : 's'}`;
}

function postedLabel(iso) {
  if (!iso) return 'Recently posted';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Recently posted';
  const hours = Math.floor((Date.now() - date.getTime()) / 36e5);
  if (hours < 1) return 'Posted just now';
  if (hours < 24) return `Posted ${hours}h ago`;
  return `Posted ${Math.floor(hours / 24)}d ago`;
}

function formatSalary(min, max) {
  const fmt = n => `$${Math.round(n / 1000)}k`;
  if (min && max && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt(min || max);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDocDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildTags(match) {
  const tags = [];
  if (match.salaryMin || match.salaryMax) tags.push(formatSalary(match.salaryMin, match.salaryMax));
  if (match.location && /remote/i.test(match.location)) tags.push('Remote');
  return tags;
}

// --- rendering ------------------------------------------------------------
/** Signal band for a match score. 70 is Orbit's own strong-match cutoff. */
function scoreBand(score) {
  if (score >= 90) return '3';
  if (score >= 70) return '2';
  if (score >= 50) return '1';
  return '0';
}

function createJobCard(match) {
  const card = document.createElement('article');
  card.className = 'job-card';
  card.dataset.jobId = match.jobId;
  // Drives the signal strip on the card's bottom edge (see styles.css).
  card.dataset.band = scoreBand(match.score);
  card.style.setProperty('--score', match.score);

  const logo = document.createElement('div');
  logo.className = 'company-logo generic';
  logo.textContent = initials(match.company);

  const info = document.createElement('div');
  info.className = 'job-info';

  const titleRow = document.createElement('div');
  const h3 = document.createElement('h3');
  h3.textContent = match.title;
  const scoreSpan = document.createElement('span');
  scoreSpan.className = `score${match.score >= 90 ? ' high' : ''}`;
  scoreSpan.dataset.band = scoreBand(match.score);
  scoreSpan.textContent = `${match.score}% match`;
  titleRow.append(h3, scoreSpan);

  const meta = document.createElement('p');
  meta.append(document.createTextNode(match.company + ' '));
  const sep = document.createElement('i');
  sep.textContent = '•';
  meta.append(sep, document.createTextNode(' ' + (match.location || 'Location unknown')));

  const tags = document.createElement('div');
  tags.className = 'tags';
  for (const tag of buildTags(match)) {
    const span = document.createElement('span');
    span.textContent = tag;
    tags.append(span);
  }

  info.append(titleRow, meta, tags);

  const action = document.createElement('div');
  action.className = 'job-action';
  const small = document.createElement('small');
  small.textContent = postedLabel(match.postedAt);
  const btn = document.createElement('button');
  btn.className = 'apply-btn';
  btn.dataset.jobId = match.jobId;
  btn.textContent = match.applicationStatus === 'approved' ? 'Approved ✓' : 'Review';
  action.append(small, btn);

  card.append(logo, info, action);
  return card;
}

function createSourceRow(source) {
  const li = document.createElement('li');
  const icon = document.createElement('span');
  icon.className = 'source-icon generic-source';
  icon.textContent = source.type === 'remotive' ? '⚙' : '⌁';
  const label = document.createElement('span');
  label.textContent = source.name;
  const cadence = document.createElement('em');
  cadence.textContent = source.enabled ? `Every ${source.cadence_minutes}m` : 'Paused';
  const dot = document.createElement('i');
  dot.className = source.enabled ? 'online' : '';
  li.append(icon, label, cadence, dot);
  return li;
}

function createDocumentRow(doc) {
  const li = document.createElement('li');
  const icon = document.createElement('span');
  icon.className = 'doc-icon';
  icon.textContent = '▤';
  const label = document.createElement('span');
  label.textContent = doc.name;
  const meta = document.createElement('em');
  meta.textContent = `${formatBytes(doc.size)} · ${formatDocDate(doc.modifiedAt)}`;
  const view = document.createElement('a');
  view.className = 'doc-view';
  view.href = `/api/documents/${encodeURIComponent(doc.name)}`;
  view.target = '_blank';
  view.rel = 'noopener';
  view.textContent = 'View →';
  li.append(icon, label, meta, view);
  return li;
}

function renderAgentStatus(activeCount) {
  const active = activeCount > 0;
  agentStatus.textContent = active ? 'Scout is actively looking' : 'Scout is paused';
  agentPulse.style.background = active ? '' : '#88928a';
  pauseAgentBtn.textContent = active ? 'Pause' : 'Resume';
}

// --- data loading ------------------------------------------------------------
async function loadOverview() {
  const data = await getJSON('/api/overview');
  metricNewRoles.textContent = data.newRoles;
  metricStrongMatches.textContent = data.strongMatches;
  metricApplicationsPrepared.textContent = data.applicationsPrepared;
  nextScanTimeEl.textContent = formatNextScan(data.nextScanAt);
  activeSourcesCountEl.textContent = `Across ${data.activeSources} active source${data.activeSources === 1 ? '' : 's'}`;
  applicationsGoalLabel.textContent = `${data.applicationsPrepared} application${data.applicationsPrepared === 1 ? '' : 's'} prepared`;
  profileName.textContent = data.candidateName;
  profileAvatar.textContent = initials(data.candidateName);
}

/**
 * Renders the weekly chart from real application activity.
 *
 * This panel used to be seven hardcoded bars and a literal "+18%". A progress chart that
 * invents its own numbers is worse than no chart — it answers "is the search moving?" with
 * fiction. Everything here comes from /api/activity, which counts rows in applications.
 */
async function loadActivity() {
  const data = await getJSON('/api/activity');

  // Scale to the busiest day so a quiet week still reads, with a floor of 1 to avoid /0.
  const peak = Math.max(1, ...data.days.map(d => d.count));
  const axisLabels = [peak, Math.round(peak / 2), 0];
  activityAxis.innerHTML = '';
  for (const value of axisLabels) {
    const span = document.createElement('span');
    span.textContent = value;
    activityAxis.append(span);
  }

  activityBars.innerHTML = '';
  data.days.forEach((day, index) => {
    const wrap = document.createElement('div');
    // A zero day still gets a sliver so the baseline reads as a day, not a gap.
    wrap.style.setProperty('--h', `${day.count === 0 ? 2 : Math.round((day.count / peak) * 100)}%`);
    if (index === data.days.length - 1) wrap.className = 'today';
    wrap.title = `${day.date}: ${day.count} application${day.count === 1 ? '' : 's'} prepared`;
    const bar = document.createElement('i');
    const label = document.createElement('small');
    label.textContent = day.label;
    wrap.append(bar, label);
    activityBars.append(wrap);
  });

  activityHeading.textContent =
    data.thisWeek === 0 ? 'Nothing yet this week' : `${data.thisWeek} prepared this week`;

  // Null means there was no prior week to compare against. Showing 0% would assert "flat",
  // which is a different and false claim.
  if (data.changePct === null) {
    activityChange.hidden = true;
  } else {
    activityChange.hidden = false;
    activityChange.textContent = `${data.changePct >= 0 ? '↑' : '↓'} ${Math.abs(data.changePct)}%`;
  }

  activityGoalFill.style.width = `${Math.round((data.thisWeek / Math.max(data.thisWeek, data.priorWeek, 1)) * 100)}%`;
}

async function loadMatches() {
  const { matches } = await getJSON('/api/matches');
  matchesById = new Map(matches.map(m => [m.jobId, m]));
  matchesTotal.textContent = matches.length;
  navMatchesCount.textContent = matches.length;
  matchesEl.innerHTML = '';
  if (matches.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No matches yet — click "Run agent" to scan your sources.';
    matchesEl.append(p);
    return;
  }
  for (const match of matches) matchesEl.append(createJobCard(match));
}

async function loadSources() {
  const { sources } = await getJSON('/api/sources');
  sourcesCache = sources;
  sourcesHeading.textContent = `Watching ${sources.length} site${sources.length === 1 ? '' : 's'}`;
  sourceList.innerHTML = '';
  if (sources.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No sources yet — add one with the + button.';
    sourceList.append(li);
  } else {
    for (const source of sources) sourceList.append(createSourceRow(source));
  }
  renderAgentStatus(sources.filter(s => s.enabled).length);
}

async function loadDocuments() {
  const { documents, folder } = await getJSON('/api/documents');
  if (folder) documentsFolderPath.textContent = folder;
  documentList.innerHTML = '';
  if (documents.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = 'No documents yet — drop a file into the folder above.';
    documentList.append(li);
    return;
  }
  for (const doc of documents) documentList.append(createDocumentRow(doc));
}

// --- pipeline ------------------------------------------------------------
function createPipelineRow(row, stage) {
  const li = document.createElement('li');
  li.className = 'pipeline-row';

  const info = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = row.title;
  const company = document.createElement('p');
  company.textContent = row.company;
  info.append(title, company);
  li.append(info);

  if (row.score !== null) {
    const score = document.createElement('span');
    score.className = `score${row.score >= 90 ? ' high' : ''}`;
    score.dataset.band = scoreBand(row.score);
    score.textContent = `${row.score}%`;
    li.append(score);
  }

  if (stage === 'matched') {
    li.classList.add('clickable');
    li.addEventListener('click', async () => {
      try {
        const application = await postJSON(`/api/applications/${row.jobId}/draft`);
        openReviewDialog(application);
        await loadPipeline();
      } catch (err) {
        alert(`Could not prepare a draft: ${err.message}`);
      }
    });
  } else if (stage === 'drafted' || stage === 'approved') {
    li.classList.add('clickable');
    li.addEventListener('click', async () => {
      try {
        const application = await getJSON(`/api/applications/${row.applicationId}`);
        openReviewDialog(application);
      } catch (err) {
        alert(`Could not load application: ${err.message}`);
      }
    });
  }

  return li;
}

async function loadPipeline() {
  const { stages, counts } = await getJSON('/api/pipeline');
  for (const stage of ['new', 'matched', 'drafted', 'approved']) {
    document.querySelector(`#pipeline-count-${stage}`).textContent = counts[stage];
    const list = document.querySelector(`#pipeline-list-${stage}`);
    list.innerHTML = '';
    if (stages[stage].length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = stage === 'new' ? 'Nothing waiting to be scored.' : 'Nothing here yet.';
      list.append(li);
      continue;
    }
    for (const row of stages[stage]) list.append(createPipelineRow(row, stage));
  }
}

// --- settings ------------------------------------------------------------
function renderTagEditor(container, items, onRemove) {
  container.innerHTML = '';
  for (const item of items) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const label = document.createElement('span');
    label.textContent = item;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => onRemove(item));
    chip.append(label, removeBtn);
    container.append(chip);
  }
}

function renderLocationPresets() {
  locationPresetsEl.innerHTML = '';
  const active = new Set(profileDraft.locations.map(l => l.toLowerCase()));
  for (const preset of profileDraft.locationPresets) {
    if (active.has(preset.toLowerCase())) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-chip';
    btn.textContent = `+ ${preset}`;
    btn.addEventListener('click', () => {
      profileDraft.locations = [...profileDraft.locations, preset];
      renderSettings();
    });
    locationPresetsEl.append(btn);
  }
}

const NOTIFY_DEFAULT_HINT =
  "Sends one batched message when a scheduled scan turns up matches you haven't seen yet.";

/** Shows how many jobs clear each cut-off, highlighting the band your threshold sits in. */
function renderDistribution() {
  const d = profileDraft.distribution;
  distributionEl.innerHTML = '';
  if (!d) return;

  const threshold = Number(notifyThresholdEl.value || profileDraft.notifyThreshold || 0);
  const bands = [
    { label: '≥55%', min: 55, n: d.at55 },
    { label: '≥65%', min: 65, n: d.at65 },
    { label: '≥75%', min: 75, n: d.at75 },
    { label: '≥85%', min: 85, n: d.at85 },
    { label: '≥90%', min: 90, n: d.at90 },
  ];
  // The active band is the tightest cut-off your threshold still clears.
  const active = [...bands].reverse().find(b => threshold >= b.min);

  const total = document.createElement('span');
  total.className = 'dist-chip';
  total.innerHTML = `<b>${d.total}</b> jobs scored`;
  distributionEl.append(total);

  for (const band of bands) {
    const chip = document.createElement('span');
    chip.className = `dist-chip${active && band.min === active.min ? ' active' : ''}`;
    chip.innerHTML = `${band.label} <b>${band.n}</b>`;
    distributionEl.append(chip);
  }
}

function renderNotifySettings() {
  notifyEnabledEl.checked = Boolean(profileDraft.notifyEnabled);
  notifyThresholdEl.value = profileDraft.notifyThreshold ?? 70;
  skillTargetEl.value = profileDraft.skillTarget ?? 5;
  skillFamilyTargetEl.value = profileDraft.skillFamilyTarget ?? 4;
  renderDistribution();

  const configured = profileDraft.telegramConfigured;
  notifyEnabledEl.disabled = !configured;
  notifyTestBtn.disabled = !configured;
  notifyHint.classList.toggle('warn', !configured);
  notifyHint.textContent = configured
    ? NOTIFY_DEFAULT_HINT
    : 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in server/.env to enable notifications.';
}

function renderSettings() {
  settingsSalaryMin.value = profileDraft.salaryMin ?? '';
  settingsSalaryMax.value = profileDraft.salaryMax ?? '';
  renderNotifySettings();
  renderTagEditor(locationsEditor, profileDraft.locations, item => {
    profileDraft.locations = profileDraft.locations.filter(l => l !== item);
    renderSettings();
  });
  renderTagEditor(exclusionsEditor, profileDraft.exclusions, item => {
    profileDraft.exclusions = profileDraft.exclusions.filter(e => e !== item);
    renderSettings();
  });
  renderTagEditor(skillsEditor, profileDraft.skills, item => {
    profileDraft.skills = profileDraft.skills.filter(s => s !== item);
    renderSettings();
  });
  renderLocationPresets();
}

async function loadProfile() {
  const data = await getJSON('/api/profile');
  profileDraft = { ...data };
  renderSettings();
}

function addTagFromInput(input, listKey) {
  const value = input.value.trim();
  if (!value) return;
  if (!profileDraft[listKey].some(v => v.toLowerCase() === value.toLowerCase())) {
    profileDraft[listKey] = [...profileDraft[listKey], value];
  }
  input.value = '';
  renderSettings();
}

// --- review dialog ------------------------------------------------------------
function openReviewDialog(application) {
  currentApplication = application;
  const match = matchesById.get(application.job.id);

  dialogTitle.textContent = `${application.job.company} application is ready`;
  dialogSummary.textContent = application.summary || '';
  dialogRationale.textContent = match ? match.rationale : '—';

  dialogBullets.innerHTML = '';
  for (const bullet of application.bullets) {
    const li = document.createElement('li');
    li.textContent = bullet;
    dialogBullets.append(li);
  }

  dialogDownload.href = `/api/applications/${application.id}/resume.docx`;
  dialogPrimary.textContent = application.status === 'approved' ? 'Open posting ↗' : 'Open application ↗';
  dialog.showModal();
}

// --- event wiring ------------------------------------------------------------
function setTodayLabel() {
  const formatted = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();
  todayLabel.textContent = formatted;
}

runAgentBtn.addEventListener('click', async () => {
  runAgentBtn.disabled = true;
  runAgentBtn.innerHTML = 'Scanning…';
  try {
    const summary = await postJSON('/api/scan');
    runAgentBtn.innerHTML = 'Scan complete <span>✓</span>';
    await Promise.all([loadOverview(), loadActivity(), loadMatches(), loadPipeline()]);
    if (summary.errors && summary.errors.length > 0) {
      console.warn('Some sources failed to scan:', summary.errors);
    }
  } catch (err) {
    runAgentBtn.textContent = 'Scan failed';
    console.error(err);
  } finally {
    setTimeout(() => {
      runAgentBtn.disabled = false;
      runAgentBtn.innerHTML = 'Run agent <span>→</span>';
    }, 1500);
  }
});

pauseAgentBtn.addEventListener('click', async () => {
  const activateAll = pauseAgentBtn.textContent.trim() === 'Resume';
  pauseAgentBtn.disabled = true;
  try {
    await Promise.all(sourcesCache.map(source => patchJSON(`/api/sources/${source.id}`, { enabled: activateAll })));
    await Promise.all([loadSources(), loadOverview()]);
  } catch (err) {
    console.error('Could not toggle sources:', err);
  } finally {
    pauseAgentBtn.disabled = false;
  }
});

const SOURCE_TYPES = ['remotive', 'himalayas', 'adzuna', 'usajobs', 'rss'];

addSourceBtn.addEventListener('click', async () => {
  const type = prompt(`Source type — one of: ${SOURCE_TYPES.join(', ')}`, 'remotive');
  if (!type) return;
  if (!SOURCE_TYPES.includes(type.trim())) {
    alert(`Unknown type "${type}". Must be one of: ${SOURCE_TYPES.join(', ')}`);
    return;
  }
  const input = prompt(
    type.trim() === 'rss' ? 'RSS/Atom feed URL' : 'Search keyword (e.g. "cloud security engineer")'
  );
  if (!input) return;
  try {
    await postJSON('/api/sources', { type: type.trim(), input });
    await loadSources();
  } catch (err) {
    alert(`Could not add source: ${err.message}`);
  }
});

matchesEl.addEventListener('click', async event => {
  const btn = event.target.closest('.apply-btn');
  if (!btn) return;
  const jobId = btn.dataset.jobId;
  btn.disabled = true;
  try {
    const application = await postJSON(`/api/applications/${jobId}/draft`);
    openReviewDialog(application);
    await loadPipeline();
  } catch (err) {
    alert(`Could not prepare a draft: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

locationsAddBtn.addEventListener('click', () => addTagFromInput(locationsInput, 'locations'));
locationsInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTagFromInput(locationsInput, 'locations');
  }
});
exclusionsAddBtn.addEventListener('click', () => addTagFromInput(exclusionsInput, 'exclusions'));
exclusionsInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTagFromInput(exclusionsInput, 'exclusions');
  }
});
skillsAddBtn.addEventListener('click', () => addTagFromInput(skillsInput, 'skills'));
skillsInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTagFromInput(skillsInput, 'skills');
  }
});

settingsSaveBtn.addEventListener('click', async () => {
  settingsSaveBtn.disabled = true;
  settingsStatus.textContent = '';
  try {
    const salaryMin = settingsSalaryMin.value === '' ? null : Number(settingsSalaryMin.value);
    const salaryMax = settingsSalaryMax.value === '' ? null : Number(settingsSalaryMax.value);
    const updated = await patchJSON('/api/profile', {
      salaryMin,
      salaryMax,
      locations: profileDraft.locations,
      exclusions: profileDraft.exclusions,
      skills: profileDraft.skills,
      notifyEnabled: notifyEnabledEl.checked,
      notifyThreshold: notifyThresholdEl.value === '' ? 70 : Number(notifyThresholdEl.value),
      skillTarget: skillTargetEl.value === '' ? 5 : Number(skillTargetEl.value),
      skillFamilyTarget: skillFamilyTargetEl.value === '' ? 4 : Number(skillFamilyTargetEl.value),
    });
    profileDraft = { ...updated };
    renderSettings();
    settingsStatus.textContent = `Saved — re-scored ${updated.rescored} job${updated.rescored === 1 ? '' : 's'}`;
    await Promise.all([loadOverview(), loadActivity(), loadMatches()]);
  } catch (err) {
    settingsStatus.textContent = '';
    alert(`Could not save settings: ${err.message}`);
  } finally {
    settingsSaveBtn.disabled = false;
  }
});

notifyThresholdEl.addEventListener('input', renderDistribution);

notifyTestBtn.addEventListener('click', async () => {
  notifyTestBtn.disabled = true;
  const original = notifyTestBtn.textContent;
  notifyTestBtn.textContent = 'Sending…';
  try {
    await postJSON('/api/profile/test-notification');
    notifyTestBtn.textContent = 'Sent ✓';
  } catch (err) {
    notifyTestBtn.textContent = 'Failed';
    alert(`Test message failed: ${err.message}`);
  } finally {
    setTimeout(() => {
      notifyTestBtn.textContent = original;
      notifyTestBtn.disabled = false;
    }, 2000);
  }
});

closeDialogBtn.addEventListener('click', () => dialog.close());

dialogPrimary.addEventListener('click', async () => {
  if (!currentApplication) return;
  dialogPrimary.disabled = true;
  try {
    const approved = await postJSON(`/api/applications/${currentApplication.id}/approve`);
    window.open(approved.job.url, '_blank', 'noopener');
    dialog.close();
    await Promise.all([loadOverview(), loadActivity(), loadMatches(), loadPipeline()]);
  } catch (err) {
    alert(`Could not approve: ${err.message}`);
  } finally {
    dialogPrimary.disabled = false;
  }
});

// --- init ------------------------------------------------------------
setTodayLabel();
Promise.all([loadOverview(), loadActivity(), loadMatches(), loadSources(), loadDocuments(), loadProfile(), loadPipeline()]).catch(err => {
  console.error('Initial load failed:', err);
});
