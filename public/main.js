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
let currentDuration = '7d';

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

function workflowLineOption(title, runs, jobNames, cutoff) {
  const slice = withinWindow(runs || [], cutoff);
  const series = jobNames.map(name => ({
    name,
    type: 'line',
    showSymbol: false,
    data: slice
      .map(r => {
        const v = r.jobs && r.jobs[name];
        if (!v) return null;
        return [new Date(r.date).getTime(), v / 3600];
      })
      .filter(p => p && p[1] > 0),
  }));
  return {
    title: { text: title, left: 'left' },
    grid: { left: 60, right: 30, top: 70, bottom: 50 },
    legend: { top: 30 },
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
}

function dockerSizeOption(title, perTag, sizeField, cutoff) {
  const now = Date.now();
  const series = Object.keys(perTag || {}).map(tag => {
    const slice = withinWindow(perTag[tag] || [], cutoff);
    const data = slice.map(d => ({
      value: [new Date(d.date).getTime(), d[sizeField] / 1e9],
      digest: d.digest,
    }));
    // Extend each tag's line to the current datetime with a flat segment so
    // the right edge of the chart reflects the latest known size — even if
    // the image hasn't been remeasured recently. `symbol: 'none'` keeps this
    // extrapolated endpoint from looking like a real measurement.
    if (data.length) {
      const last = data[data.length - 1];
      if (last.value[0] < now) {
        data.push({
          value: [now, last.value[1]],
          digest: last.digest,
          symbol: 'none',
        });
      }
    }
    return {
      name: tag,
      type: 'line',
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 9,
      lineStyle: { width: 3 },
      emphasis: { focus: 'series', scale: 1.4 },
      data,
    };
  });
  return {
    title: { text: title, left: 'left' },
    grid: { left: 70, right: 30, top: 70, bottom: 50 },
    legend: { top: 30, type: 'scroll' },
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

  return {
    grid: { left: 160, right: 30, top: 50, bottom: 40 },
    legend: { top: 10, data: legendNames },
    xAxis: { type: 'time' },
    yAxis: {
      type: 'value',
      min: -0.5,
      max: REPOS.length - 0.5,
      interval: 1,
      inverse: false,
      axisLabel: {
        formatter: v => REPOS[Math.round(v)] || '',
        fontSize: 12,
        color: '#444',
      },
      axisTick: { show: false },
      axisLine: { show: false },
      splitLine: { lineStyle: { type: 'dashed', color: '#eee' } },
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
      ...REPOS.map(repo => ({
        name: `${repo}__rail`,
        type: 'line',
        showSymbol: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { color: 'rgba(100,116,139,0.4)', width: 1 },
        data: rails.get(repo),
        z: 1,
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
          borderColor: '#fff',
          borderWidth: 1,
          opacity: 0.85,
        },
        emphasis: { scale: 1.15 },
        z: 2,
      })),
    ],
  };
}

function renderAll() {
  const cutoff = cutoffDate(currentDuration);
  charts.repoSwimlane.setOption(repoSwimlaneOption(cutoff), true);
  charts.healthCheck.setOption(
    workflowLineOption('Build duration',
      rawData.workflow_time['health-check'], HEALTH_CHECK_JOBS, cutoff),
    true
  );
  charts.dockerBuild.setOption(
    workflowLineOption('Build duration',
      rawData.workflow_time['docker-build-and-push'], DOCKER_BUILD_JOBS, cutoff),
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
}

function wireDurationButtons() {
  document.querySelectorAll('[data-duration]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentDuration = btn.dataset.duration;
      document.querySelectorAll('[data-duration]').forEach(b =>
        b.classList.toggle('active', b === btn));
      renderAll();
    });
  });
}

fetch('github_action_data.json')
  .then(res => res.json())
  .then(json => {
    rawData = json;

    charts.repoSwimlane = echarts.init(document.querySelector('#repo-swimlane-chart'));
    charts.healthCheck = echarts.init(document.querySelector('#health-check-time-chart'));
    charts.dockerBuild = echarts.init(document.querySelector('#docker-build-and-push-time-chart'));
    charts.dockerCompressed = echarts.init(document.querySelector('#docker-chart-compressed'));
    charts.dockerUncompressed = echarts.init(document.querySelector('#docker-chart-uncompressed'));

    charts.repoSwimlane.on('click', params => {
      const meta = params.data && params.data.runMeta;
      if (meta && meta.html_url) {
        window.open(meta.html_url, '_blank', 'noopener');
      }
    });

    renderAll();
    wireDurationButtons();

    window.addEventListener('resize', () => {
      Object.values(charts).forEach(c => c.resize());
    });
  });
