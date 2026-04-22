const DURATION_DAYS = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
  'all': null,
};

const HEALTH_CHECK_JOBS = ['main-amd64', 'main-arm64', 'nightly-amd64'];
const DOCKER_BUILD_JOBS = ['total'];

// ECharts' default palette pinned so the docker chart series colors and
// the latest-size table's swatches stay in sync by index.
const DOCKER_PALETTE = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc',
];

// Lane order (top → bottom) for the swimlane chart. Keys must match the
// short-names emitted by scripts/measure_workflows.py::repo_short_name.
const REPOS = ['autoware_core', 'autoware_universe', 'autoware_tools'];

const CONCLUSION_STYLE = {
  success:         { color: '#28a745', icon: '✅', label: 'success' },
  failure:         { color: '#d73a49', icon: '❌', label: 'failure' },
  cancelled:       { color: '#6a737d', icon: '⚪', label: 'cancelled' },
  skipped:         { color: '#b08800', icon: '⏭', label: 'skipped' },
  timed_out:       { color: '#d73a49', icon: '⏱', label: 'timed out' },
  action_required: { color: '#d73a49', icon: '⚠', label: 'action required' },
  neutral:         { color: '#6a737d', icon: '⚪', label: 'neutral' },
  startup_failure: { color: '#d73a49', icon: '⚠', label: 'startup failure' },
};
const UNKNOWN_STYLE = { color: '#6a737d', icon: '❔', label: 'unknown' };
// Render success bubbles underneath so failures stay visible on busy days.
const CONCLUSION_ORDER = [
  'success', 'skipped', 'cancelled', 'neutral',
  'timed_out', 'action_required', 'startup_failure', 'failure',
];

// Deterministic Y jitter within a lane band so time-clustered runs don't
// stack exactly on top of each other. Keyed on run_id so the same run
// lands at the same Y across re-renders.
const SWIMLANE_JITTER = 0.32;

let rawData = null;
let charts = {};

// Initial state is hydrated from ?duration=…&distro=… so views are
// shareable via URL. Anything not in the URL falls back to defaults.
function readStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const d = params.get('duration');
  const di = params.get('distro');
  return {
    duration: DURATION_DAYS.hasOwnProperty(d) ? d : '7d',
    distro: ['humble', 'jazzy', 'all'].includes(di) ? di : 'jazzy',
  };
}
const _initial = readStateFromUrl();
let currentDuration = _initial.duration;
let currentDistro = _initial.distro;

function writeStateToUrl() {
  const params = new URLSearchParams(window.location.search);
  params.set('duration', currentDuration);
  params.set('distro', currentDistro);
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}?${params.toString()}${window.location.hash}`
  );
}

function tagMatchesDistro(tag) {
  return currentDistro === 'all' || tag.endsWith(`-${currentDistro}`);
}

function cutoffDate(durationKey) {
  const days = DURATION_DAYS[durationKey];
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function withinWindow(items, cutoff) {
  if (!cutoff) return items;
  return items.filter(d => new Date(d.date) >= cutoff);
}

function conclusionStyle(c) {
  return CONCLUSION_STYLE[c] || UNKNOWN_STYLE;
}

function formatDuration(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function laneJitter(runId) {
  const n = Number(runId) || 0;
  // Mulberry-lite hash — deterministic, cheap, enough spread for this use.
  const h = ((n * 2654435761) >>> 0) / 4294967296;
  return (h - 0.5) * 2 * SWIMLANE_JITTER;
}

// Shared dataZoom: drag = 1:1 pan, wheel = zoom. filterMode:none keeps
// all series data present across zoom so tooltips + legend remain stable.
function insideZoom() {
  return [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }];
}

// Shared toolbox: reset-zoom and save-as-PNG in every chart's top-right
// corner. Restore wipes the current pan+zoom+legend-toggle state back to
// the initial render.
function chartToolbox() {
  return {
    right: 10,
    top: 0,
    itemSize: 14,
    feature: {
      restore: { title: 'Reset zoom / toggles' },
      saveAsImage: { title: 'Save as PNG', pixelRatio: 2 },
    },
  };
}

// Centered text graphic used when a chart has no data for the current
// window. Caller decides when to apply it.
function emptyStateGraphic(message) {
  return [{
    type: 'text',
    left: 'center',
    top: 'middle',
    style: {
      text: message,
      fontSize: 13,
      fill: themeColors().textMuted,
      textAlign: 'center',
    },
  }];
}

function themeState() {
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark' : 'light';
}

function themeColors() {
  const dark = themeState() === 'dark';
  return {
    cardBg: dark ? '#131b2c' : '#ffffff',
    textMuted: dark ? '#94a3b8' : '#9ca3af',
    text: dark ? '#e5e7eb' : '#444444',
  };
}

function workflowLineOption(title, runs, jobNames, cutoff, labelMap) {
  const slice = withinWindow(runs || [], cutoff);
  const labels = labelMap || {};
  const labelFor = key => labels[key] || key;

  // Success runs drive the line series. Runs without a conclusion (legacy
  // data and per-job workflows like health-check) are treated as success
  // for back-compat.
  const successRuns = slice.filter(
    r => !r.conclusion || r.conclusion === 'success'
  );
  const nonSuccessRuns = slice.filter(
    r => r.conclusion && r.conclusion !== 'success'
  );

  const lineSeries = jobNames.map(name => ({
    name: labelFor(name),
    type: 'line',
    showSymbol: true,
    symbol: 'circle',
    symbolSize: 9,
    lineStyle: { width: 4 },
    emphasis: { focus: 'series', scale: 1.4 },
    data: successRuns
      .map(r => {
        const v = r.jobs && r.jobs[name];
        if (!v) return null;
        // Object form (value: […]) lets us carry runMeta through to the
        // chart's click handler, so hovering a success point on
        // docker-build-and-push opens that specific run. health-check
        // data has no html_url so the click handler no-ops for it.
        return {
          value: [new Date(r.date).getTime(), v / 3600],
          runMeta: {
            html_url: r.html_url,
            conclusion: 'success',
            duration: v,
            date: r.date,
          },
        };
      })
      .filter(p => p && p.value[1] > 0),
  }));

  // Bucket non-success runs by conclusion so each gets its own legend
  // entry + colour. Uses the first job name as the y-axis value — for
  // docker-build-and-push that's the "total" wall-clock; for health-check
  // this path is empty because its runs carry no conclusion (accurate=True
  // + only_success=True by default).
  const byConclusion = {};
  nonSuccessRuns.forEach(r => {
    const v = r.jobs && r.jobs[jobNames[0]];
    if (v == null) return;
    if (!byConclusion[r.conclusion]) byConclusion[r.conclusion] = [];
    byConclusion[r.conclusion].push({
      value: [new Date(r.date).getTime(), v / 3600],
      runMeta: {
        html_url: r.html_url,
        conclusion: r.conclusion,
        duration: v,
        date: r.date,
      },
    });
  });
  const conclusionKeys = CONCLUSION_ORDER.filter(k => byConclusion[k]).concat(
    Object.keys(byConclusion).filter(k => !CONCLUSION_ORDER.includes(k))
  );
  const scatterSeries = conclusionKeys.map(k => ({
    name: conclusionStyle(k).label,
    type: 'scatter',
    symbolSize: 12,
    itemStyle: {
      color: conclusionStyle(k).color,
      borderColor: themeColors().cardBg,
      borderWidth: 1,
    },
    emphasis: { scale: 1.2 },
    data: byConclusion[k],
    z: 3,
  }));

  const series = [...lineSeries, ...scatterSeries];
  const isEmpty = !successRuns.length && !nonSuccessRuns.length;
  const option = {
    title: { text: title, left: 'left' },
    grid: { left: 60, right: 30, top: 70, bottom: 50 },
    legend: { top: 30 },
    toolbox: chartToolbox(),
    xAxis: { type: 'time' },
    yAxis: {
      type: 'value', min: 0,
      axisLabel: { formatter: v => `${v.toFixed(2)}h` },
      name: 'Duration',
    },
    dataZoom: insideZoom(),
    tooltip: {
      trigger: 'axis',
      formatter: params => {
        if (!params || !params.length) return '';
        const date = echarts.format.formatTime('yyyy-MM-dd hh:mm', params[0].value[0]);
        const lines = params
          .filter(p => p.value && p.value[1] != null)
          .map(p => `${p.marker} ${escapeHtml(p.seriesName)}: <b>${p.value[1].toFixed(2)}h</b>`);
        return `<b>${date}</b><br/>${lines.join('<br/>')}`;
      },
    },
    series,
  };
  if (isEmpty) {
    option.graphic = { elements: emptyStateGraphic('No runs in this window') };
  }
  return option;
}

function dockerSizeOption(title, perTag, sizeField, cutoff) {
  const now = Date.now();
  // The palette is indexed by the *original* tag position so swatches in
  // the sidebar table match chart colors regardless of which distro is
  // active. Filter tags but remember each one's original index.
  const allTags = Object.keys(perTag || {});
  const visibleTagEntries = allTags
    .map((tag, i) => ({ tag, paletteIndex: i }))
    .filter(({ tag }) => tagMatchesDistro(tag));
  const series = visibleTagEntries.map(({ tag, paletteIndex }) => {
    // Defensive sort — per-tag arrays come from appended JSONL so they're
    // effectively chronological, but we rely on it for the cutoff split.
    const all = (perTag[tag] || []).slice().sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );
    const inWindow = cutoff
      ? all.filter(d => new Date(d.date) >= cutoff)
      : all;
    const data = inWindow.map(d => ({
      value: [new Date(d.date).getTime(), d[sizeField] / 1e9],
      digest: d.digest,
    }));
    // Leading anchor at the cutoff boundary carrying the last pre-cutoff
    // value. Ensures every tag has a visible line across the whole time
    // window even when no measurement falls inside it (e.g. 1d view of a
    // stable image) — otherwise the series becomes empty and vanishes.
    if (cutoff) {
      let beforeCutoff = null;
      for (const d of all) {
        if (new Date(d.date) < cutoff) beforeCutoff = d;
        else break;
      }
      if (beforeCutoff) {
        data.unshift({
          value: [cutoff.getTime(), beforeCutoff[sizeField] / 1e9],
          digest: beforeCutoff.digest,
          // emptyCircle distinguishes a synthetic anchor from a real
          // measurement while still being hoverable for the tooltip.
          symbol: 'emptyCircle',
        });
      }
    }
    // Trailing anchor: extend to now with a flat segment so the right edge
    // reflects the latest known size even if the image hasn't been
    // remeasured recently. `symbol: 'none'` keeps both synthetic endpoints
    // from looking like real measurements.
    if (data.length) {
      const last = data[data.length - 1];
      if (last.value[0] < now) {
        data.push({
          value: [now, last.value[1]],
          digest: last.digest,
          symbol: 'emptyCircle',
        });
      }
    }
    const color = DOCKER_PALETTE[paletteIndex % DOCKER_PALETTE.length];
    return {
      name: tag,
      type: 'line',
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 9,
      itemStyle: { color },
      lineStyle: { width: 4, color },
      emphasis: { focus: 'series', scale: 1.4 },
      label: {
        show: true,
        position: 'top',
        fontSize: 10,
        color: '#444',
        formatter: p => `${p.value[1].toFixed(2)}GB`,
      },
      // Shift colliding labels vertically first; hide whatever still
      // overlaps. ECharts recomputes after each zoom, so density drops
      // reveal more labels naturally.
      labelLayout: {
        moveOverlap: 'shiftY',
        hideOverlap: true,
      },
      data,
    };
  });
  const option = {
    color: DOCKER_PALETTE,
    // These charts are rebuilt from scratch on distro/time-range changes
    // (setOption with notMerge). The default 1s create-animation felt
    // sluggish; snappy updates without animation read better here.
    animation: false,
    title: { text: title, left: 'left' },
    grid: { left: 70, right: 30, top: 70, bottom: 50 },
    legend: { top: 30, type: 'scroll' },
    toolbox: chartToolbox(),
    xAxis: { type: 'time' },
    yAxis: {
      type: 'value', min: 0,
      axisLabel: { formatter: v => `${v.toFixed(2)}GB` },
      name: 'Size',
    },
    dataZoom: insideZoom(),
    tooltip: {
      trigger: 'item',
      formatter: p => {
        const gb = p.value[1].toFixed(2);
        const digest = p.data && p.data.digest;
        let digestHtml = '';
        if (digest && digest.startsWith('sha256:')) {
          digestHtml = `<br/><span style="font-family:monospace;font-size:11px;">${escapeHtml(digest.substring(0, 19))}...</span>`;
        }
        return `<b>${escapeHtml(p.seriesName)}</b>: ${gb}GB${digestHtml}`;
      },
    },
    series,
  };
  if (!visibleTagEntries.length) {
    option.graphic = {
      elements: emptyStateGraphic(
        allTags.length ? 'No images for this distro' : 'No image data'),
    };
  }
  return option;
}

function repoSwimlaneOption(cutoff) {
  const buckets = {};
  const rails = new Map(REPOS.map(r => [r, []]));

  REPOS.forEach((repo, repoIndex) => {
    const runs = withinWindow((rawData.repo_ci_runs || {})[repo] || [], cutoff);
    runs.forEach(r => {
      const key = r.conclusion || 'unknown';
      if (!buckets[key]) buckets[key] = [];
      const x = new Date(r.date).getTime();
      const y = repoIndex + laneJitter(r.run_id);
      const dur = r.duration || 0;
      buckets[key].push({
        value: [x, y, dur],
        runMeta: {
          conclusion: key,
          duration: dur,
          html_url: r.html_url,
          head_sha: r.head_sha,
          commit_title: r.commit_title,
          date: r.date,
          repo,
        },
      });
      rails.get(repo).push([x, y]);
    });
  });
  rails.forEach(pts => pts.sort((a, b) => a[0] - b[0]));

  const conclusionKeys = CONCLUSION_ORDER.filter(k => buckets[k]).concat(
    Object.keys(buckets).filter(k => !CONCLUSION_ORDER.includes(k))
  );

  const legendNames = conclusionKeys.map(k => conclusionStyle(k).label);
  const totalBubbles = conclusionKeys.reduce(
    (n, k) => n + (buckets[k] || []).length, 0);

  const option = {
    grid: { left: 160, right: 30, top: 50, bottom: 70 },
    legend: { top: 10, data: legendNames },
    toolbox: chartToolbox(),
    xAxis: {
      type: 'time',
      // yAxis range includes 0, so without this the x-axis line would be
      // drawn at y=0 (the centre of autoware_core's row) instead of at
      // the plot's bottom edge.
      axisLine: { onZero: false },
    },
    yAxis: {
      type: 'value',
      // inverse flips value-axis direction so REPOS[0] (autoware_core)
      // renders at the top and REPOS[last] at the bottom, matching the
      // natural top-to-bottom reading of the REPOS array.
      inverse: true,
      // Slight overshoot beyond lane centers so top-row jitter doesn't
      // hug the legend and bottom-row jitter doesn't hug the date axis.
      min: -0.6,
      max: REPOS.length - 0.4,
      axisLabel: {
        // Anchor labels at lane centers (0, 1, 2) rather than at the
        // default tick positions which would land on lane boundaries.
        customValues: REPOS.map((_, i) => i),
        formatter: v => REPOS[Math.round(v)] || '',
        fontSize: 12,
        color: '#444',
      },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { show: false },
    },
    dataZoom: insideZoom(),
    tooltip: {
      trigger: 'item',
      extraCssText: 'max-width: 380px;',
      formatter: p => {
        const m = p.data && p.data.runMeta;
        if (!m) return '';
        const style = conclusionStyle(m.conclusion);
        const sha = (m.head_sha || '').substring(0, 7);
        const title = escapeHtml(m.commit_title);
        return `
          <div><b>${style.icon} ${escapeHtml(style.label)}</b> · ${formatDuration(m.duration)}</div>
          <div style="color:#666;font-size:11px;">${escapeHtml(m.repo)} · ${escapeHtml(m.date)}</div>
          ${sha ? `<div style="font-family:monospace;font-size:11px;">${sha}${title ? ' — ' + title : ''}</div>` : ''}
        `;
      },
    },
    series: [
      // One line per repo threading through the jittered bubble centers.
      // Silent + no tooltip + not in legend so they read as pure rails.
      ...REPOS.map((repo, i) => ({
        name: `${repo}__rail`,
        type: 'line',
        showSymbol: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { color: 'rgba(100,116,139,0.4)', width: 1 },
        data: rails.get(repo),
        z: 1,
        // Attach the row separators to the first rail series (once only) —
        // markLine is decoupled from axisLabel.customValues, so it won't
        // duplicate at lane centers the way splitLine would.
        ...(i === 0 ? {
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { type: 'solid', color: '#cbd5e1', width: 1 },
            // Lane boundaries at y = -0.5, 0.5, 1.5, 2.5 — top + between
            // rows + bottom, so the swimlane reads as a clearly bracketed
            // strip rather than three floating rows.
            data: Array.from({ length: REPOS.length + 1 }, (_, j) => ({
              yAxis: j - 0.5,
            })),
          },
          // Zebra-stripe the lanes with a very light gray so adjacent rows
          // are easy to distinguish at a glance.
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(0,0,0,0.035)' },
            data: REPOS
              .map((_, j) => j)
              .filter(j => j % 2 === 0)
              .map(j => [{ yAxis: j - 0.5 }, { yAxis: j + 0.5 }]),
          },
        } : {}),
      })),
      // Bubbles bucketed by conclusion so each gets its series color.
      ...conclusionKeys.map(k => ({
        name: conclusionStyle(k).label,
        type: 'scatter',
        data: buckets[k],
        symbolSize: val => {
          const s = Math.sqrt(Math.max(val[2] || 1, 1));
          return Math.max(5, Math.min(24, s * 0.4));
        },
        itemStyle: {
          color: conclusionStyle(k).color,
          borderColor: themeColors().cardBg,
          borderWidth: 1,
          opacity: 0.85,
        },
        emphasis: { scale: 1.15 },
        z: 2,
      })),
    ],
  };
  if (!totalBubbles) {
    option.graphic = { elements: emptyStateGraphic('No runs in this window') };
  }
  return option;
}

function formatGb(bytes) {
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

function relativeTime(iso) {
  const then = new Date(iso);
  const ms = Date.now() - then;
  if (Number.isNaN(ms)) return '';
  const mins = Math.round(ms / 60000);
  const hours = Math.round(ms / 3600000);
  const days = Math.round(ms / 86400000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function renderLatestRunsTable() {
  const container = document.getElementById('swimlane-table');
  if (!container) return;
  const cutoff = cutoffDate(currentDuration);
  const rows = REPOS.map(repo => {
    const runs = withinWindow(
      (rawData.repo_ci_runs || {})[repo] || [],
      cutoff
    );
    if (!runs.length) {
      return `
        <tr>
          <td>${escapeHtml(repo)}</td>
          <td class="status-cell muted">no runs</td>
        </tr>`;
    }
    const last = runs[runs.length - 1];
    const style = conclusionStyle(last.conclusion);
    return `
      <tr class="run-row" data-url="${escapeHtml(last.html_url || '')}"
          title="${escapeHtml(last.commit_title || style.label)}">
        <td>${escapeHtml(repo)}</td>
        <td class="status-cell">
          <span class="conclusion-icon" style="color:${style.color};"
                aria-label="${escapeHtml(style.label)}">${style.icon}</span>${escapeHtml(formatDuration(last.duration))} · ${escapeHtml(relativeTime(last.date))}
        </td>
      </tr>`;
  }).join('');
  container.innerHTML = `
    <table>
      <thead>
        <tr><th>Repo</th><th class="status-cell">Latest</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  container.querySelectorAll('.run-row').forEach(row => {
    const url = row.dataset.url;
    if (!url) return;
    row.addEventListener('click', () =>
      window.open(url, '_blank', 'noopener'));
  });
}

function renderImageSizeTable(containerId, sizeField) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const allTags = Object.keys(rawData.docker_images || {});
  // Preserve the palette index from the unfiltered tag list so the
  // sidebar swatches match the chart line colors even when the distro
  // toggle hides rows.
  const rows = allTags
    .map((tag, i) => ({ tag, paletteIndex: i }))
    .filter(({ tag }) => tagMatchesDistro(tag))
    .map(({ tag, paletteIndex }) => {
      const entries = rawData.docker_images[tag] || [];
      if (!entries.length) return '';
      const latest = entries[entries.length - 1];
      const color = DOCKER_PALETTE[paletteIndex % DOCKER_PALETTE.length];
      return `
        <tr>
          <td><span class="swatch" style="background:${color}"></span>${escapeHtml(tag)}</td>
          <td class="size-cell">${escapeHtml(formatGb(latest[sizeField] || 0))}</td>
        </tr>`;
    })
    .join('');
  container.innerHTML = `
    <table>
      <thead>
        <tr><th>Image</th><th class="size-cell">Latest</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAll() {
  const cutoff = cutoffDate(currentDuration);
  charts.repoSwimlane.setOption(repoSwimlaneOption(cutoff), true);
  renderLatestRunsTable();
  charts.healthCheck.setOption(
    workflowLineOption('Build duration',
      rawData.workflow_time['health-check'], HEALTH_CHECK_JOBS, cutoff),
    true
  );
  charts.dockerBuild.setOption(
    workflowLineOption('Build duration',
      rawData.workflow_time['docker-build-and-push'], DOCKER_BUILD_JOBS, cutoff,
      { total: 'successful runs' }),
    true
  );
  charts.dockerCompressed.setOption(
    dockerSizeOption('Docker Image Size (compressed)',
      rawData.docker_images, 'size_compressed', cutoff),
    true
  );
  charts.dockerUncompressed.setOption(
    dockerSizeOption('Docker Image Size (uncompressed)',
      rawData.docker_images, 'size_uncompressed', cutoff),
    true
  );
  renderImageSizeTable('docker-table-uncompressed', 'size_uncompressed');
  renderImageSizeTable('docker-table-compressed', 'size_compressed');
}

function syncButtonActive(selector, activeValue, attr) {
  document.querySelectorAll(selector).forEach(b =>
    b.classList.toggle('active', b.dataset[attr] === activeValue));
}

function wireDurationButtons() {
  // Reflect the URL-hydrated state in button highlights before wiring.
  syncButtonActive('[data-duration]', currentDuration, 'duration');
  document.querySelectorAll('[data-duration]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDuration = btn.dataset.duration;
      syncButtonActive('[data-duration]', currentDuration, 'duration');
      writeStateToUrl();
      renderAll();
    });
  });
}

function wireDistroButtons() {
  syncButtonActive('[data-distro]', currentDistro, 'distro');
  document.querySelectorAll('[data-distro]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDistro = btn.dataset.distro;
      // Sync by value rather than element identity so a click on one
      // card's toggle also highlights the matching button on the other
      // card.
      syncButtonActive('[data-distro]', currentDistro, 'distro');
      writeStateToUrl();
      renderAll();
    });
  });
}

function setDashboardStatus(kind, innerHtml) {
  const el = document.getElementById('dashboard-status');
  if (!el) return;
  el.className = `dashboard-status${kind ? ` ${kind}` : ''}`;
  if (kind === null) {
    el.hidden = true;
    el.innerHTML = '';
  } else {
    el.hidden = false;
    el.innerHTML = innerHtml;
  }
}

// "Updated X ago" — staleness tint kicks in after 24h so the user sees
// at a glance when a fetch / publish has stopped.
function renderLastUpdated(iso) {
  const el = document.getElementById('last-updated');
  if (!el || !iso) return;
  const then = new Date(iso);
  const now = new Date();
  const ms = now - then;
  if (Number.isNaN(ms) || ms < 0) return;
  const mins = Math.round(ms / 60000);
  const hours = Math.round(ms / 3600000);
  const days = Math.round(ms / 86400000);
  let rel;
  if (mins < 2) rel = 'just now';
  else if (mins < 60) rel = `${mins}m ago`;
  else if (hours < 24) rel = `${hours}h ago`;
  else rel = `${days}d ago`;
  el.textContent = `· updated ${rel}`;
  el.title = then.toISOString();
  el.classList.toggle('stale', ms > 24 * 3600 * 1000);
}

const THEME_STORAGE_KEY = 'dashboard-theme';

function createAllCharts() {
  // ECharts' built-in 'dark' theme handles axis/label/tooltip styling;
  // our custom series colours in CONCLUSION_STYLE / DOCKER_PALETTE
  // still come through unchanged on either theme.
  const theme = themeState() === 'dark' ? 'dark' : undefined;
  charts.repoSwimlane = echarts.init(
    document.querySelector('#repo-swimlane-chart'), theme);
  charts.healthCheck = echarts.init(
    document.querySelector('#health-check-time-chart'), theme);
  charts.dockerBuild = echarts.init(
    document.querySelector('#docker-build-and-push-time-chart'), theme);
  charts.dockerCompressed = echarts.init(
    document.querySelector('#docker-chart-compressed'), theme);
  charts.dockerUncompressed = echarts.init(
    document.querySelector('#docker-chart-uncompressed'), theme);

  const openRunUrlOnClick = params => {
    const meta = params.data && params.data.runMeta;
    if (meta && meta.html_url) {
      window.open(meta.html_url, '_blank', 'noopener');
    }
  };
  charts.repoSwimlane.on('click', openRunUrlOnClick);
  charts.dockerBuild.on('click', openRunUrlOnClick);
}

function updateThemeToggleLabel() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.textContent = themeState() === 'dark' ? '☀ light' : '☾ dark';
}

function applyTheme(t, { reinitCharts = true } = {}) {
  document.documentElement.setAttribute('data-theme', t);
  updateThemeToggleLabel();
  if (reinitCharts && Object.keys(charts).length) {
    // ECharts can't change theme on an initialised instance — dispose
    // and recreate each chart, then re-run the full render pipeline so
    // everything (including option builders that read themeColors())
    // refreshes.
    Object.values(charts).forEach(c => c.dispose());
    charts = {};
    createAllCharts();
    renderAll();
  }
}

function wireThemeToggle() {
  updateThemeToggleLabel();
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = themeState() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (e) {}
    applyTheme(next);
  });
}

fetch('github_action_data.json')
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res.json();
  })
  .then(json => {
    rawData = json;
    setDashboardStatus(null);
    renderLastUpdated(json.generated_at);

    createAllCharts();

    renderAll();
    wireDurationButtons();
    wireDistroButtons();
    wireThemeToggle();
    // Normalise the URL (strip unknown params, canonicalise values) once
    // the hydrated state is actually applied.
    writeStateToUrl();

    window.addEventListener('resize', () => {
      Object.values(charts).forEach(c => c.resize());
    });
  })
  .catch(err => {
    console.error('dashboard load failed', err);
    setDashboardStatus(
      'error',
      `Failed to load <code>github_action_data.json</code>: ${escapeHtml(err.message || String(err))}. Retry in a minute — if this persists, the Pages deploy may be mid-publish or the scraper may have errored.`
    );
  });
