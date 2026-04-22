const DURATION_DAYS = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
  'all': null,
};

const HEALTH_CHECK_JOBS = ['main-amd64', 'main-arm64', 'nightly-amd64'];
// docker-build-and-push tracks one wall-clock total per push-to-main run.
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

function workflowSeries(runs, jobNames, cutoff) {
  const slice = withinWindow(runs, cutoff);
  return jobNames.map(name => ({
    name,
    data: slice
      .map(r => {
        const v = r.jobs[name];
        if (!v) return null;
        return { x: new Date(r.date).getTime(), y: v / 3600.0 };
      })
      .filter(p => p !== null && p.y > 0),
  }));
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

// Deterministic Y jitter within a lane band so time-clustered runs don't
// perfectly stack on top of each other. Keyed on run_id so the same run
// lands at the same Y across re-renders. Range chosen empirically so
// bubbles stay inside their lane at maxBubbleRadius.
const SWIMLANE_JITTER = 0.32;
function laneJitter(runId) {
  const n = Number(runId) || 0;
  // Mulberry-lite hash — deterministic, cheap, enough spread for this use.
  const h = ((n * 2654435761) >>> 0) / 4294967296;
  return (h - 0.5) * 2 * SWIMLANE_JITTER;
}

function repoSwimlaneSeries(repoCiRuns, cutoff) {
  // Bucket by conclusion — ApexCharts bubble charts colorize by series, not
  // by point, so one conclusion = one series.
  const buckets = {};
  REPOS.forEach((repo, repoIndex) => {
    const runs = withinWindow(repoCiRuns[repo] || [], cutoff);
    runs.forEach(r => {
      const key = r.conclusion || 'unknown';
      if (!buckets[key]) buckets[key] = [];
      // sqrt-scale duration: compresses the ratio between a 10s skip and
      // a 2h build so short runs stay clickable without shrinking longs.
      const z = Math.sqrt(Math.max(r.duration || 0, 1));
      buckets[key].push({
        x: new Date(r.date).getTime(),
        y: repoIndex + laneJitter(r.run_id),
        z,
        runMeta: {
          conclusion: key,
          duration: r.duration,
          html_url: r.html_url,
          head_sha: r.head_sha,
          commit_title: r.commit_title,
          date: r.date,
          repo,
        },
      });
    });
  });
  const keys = CONCLUSION_ORDER.filter(k => buckets[k]).concat(
    Object.keys(buckets).filter(k => !CONCLUSION_ORDER.includes(k))
  );
  return keys.map(k => ({
    name: conclusionStyle(k).label,
    data: buckets[k],
    color: conclusionStyle(k).color,
  }));
}

function drawLaneRails(ctx) {
  // Connect per-repo bubbles with a polyline through their centers so the
  // jittered dots read as one timeline. ApexCharts doesn't natively combine
  // bubble + line, so we post-render SVG. Coordinates come straight from
  // the chart's internal scale (w.globals) — no DOM probing, no transform
  // chain to reason about.
  const w = ctx && ctx.w;
  if (!w || !w.globals) return;
  const g = w.globals;
  const base = g.dom && g.dom.baseEl;
  const svg = base && base.querySelector('svg.apexcharts-svg');
  if (!svg) return;

  svg.querySelectorAll('.swimlane-rail').forEach(el => el.remove());

  // The inner group holds the grid + series and already carries the right
  // translate for us; we append the path there so its coordinates match.
  const inner = svg.querySelector('g.apexcharts-inner');
  if (!inner) return;

  const gridW = g.gridWidth;
  const gridH = g.gridHeight;
  const minX = g.minX;
  const maxX = g.maxX;
  const yCfg = (w.config.yaxis && w.config.yaxis[0]) || {};
  const yMin = typeof yCfg.min === 'number' ? yCfg.min : 0;
  const yMax = typeof yCfg.max === 'number' ? yCfg.max : REPOS.length - 1;
  if (!gridW || !gridH || maxX === minX || yMax === yMin) return;

  const xSpan = maxX - minX;
  const ySpan = yMax - yMin;

  const byRepo = new Map(REPOS.map(r => [r, []]));
  (w.config.series || []).forEach(s => {
    (s.data || []).forEach(p => {
      if (!p || !p.runMeta) return;
      const px = (p.x - minX) / xSpan * gridW;
      const py = gridH - (p.y - yMin) / ySpan * gridH;
      const list = byRepo.get(p.runMeta.repo);
      if (list) list.push({ x: p.x, cx: px, cy: py });
    });
  });

  byRepo.forEach(pts => {
    if (pts.length < 2) return;
    pts.sort((a, b) => a.x - b.x);
    const d = pts.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`
    ).join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'swimlane-rail');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'rgba(100,116,139,0.4)');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('pointer-events', 'none');
    inner.appendChild(path);
  });
}

function repoSwimlaneOptions() {
  return {
    chart: {
      height: 360, type: 'bubble',
      zoom: { enabled: true },
      toolbar: { autoSelected: 'pan' },
      events: {
        dataPointSelection: (_event, _ctx, config) => {
          const s = config.w.config.series[config.seriesIndex];
          const point = s && s.data[config.dataPointIndex];
          if (point && point.runMeta && point.runMeta.html_url) {
            window.open(point.runMeta.html_url, '_blank', 'noopener');
          }
        },
        mounted: drawLaneRails,
        updated: drawLaneRails,
        animationEnd: drawLaneRails,
      },
    },
    dataLabels: { enabled: false },
    fill: { opacity: 0.8 },
    stroke: { width: 1, colors: ['#ffffff'] },
    plotOptions: { bubble: { minBubbleRadius: 4, maxBubbleRadius: 12 } },
    title: { text: '', align: 'left' },
    grid: { padding: { left: 10 } },
    legend: { position: 'top' },
    xaxis: { type: 'datetime' },
    yaxis: {
      min: -0.5,
      max: REPOS.length - 0.5,
      tickAmount: REPOS.length,
      // Labels are drawn via annotations so they sit at lane centers
      // (y=0,1,2), not at tick boundaries (y=-0.5,0.5,1.5,2.5). Reserve
      // the left gutter so the annotation text isn't clipped.
      labels: { minWidth: 130, formatter: () => '' },
      axisTicks: { show: false },
      axisBorder: { show: false },
    },
    annotations: {
      yaxis: REPOS.map((name, i) => ({
        y: i,
        // The connecting polyline through the jittered bubbles is drawn in
        // drawLaneRails; we only use this annotation for the centered label.
        borderWidth: 0,
        label: {
          text: name,
          position: 'left',
          textAnchor: 'end',
          borderWidth: 0,
          offsetX: -5,
          offsetY: 5,
          style: {
            background: 'transparent',
            color: '#444',
            fontSize: '12px',
            fontFamily: 'inherit',
          },
        },
      })),
    },
    tooltip: {
      custom: ({ seriesIndex, dataPointIndex, w }) => {
        const point = w.config.series[seriesIndex].data[dataPointIndex];
        const meta = point && point.runMeta;
        if (!meta) return '';
        const style = conclusionStyle(meta.conclusion);
        const sha = (meta.head_sha || '').substring(0, 7);
        const title = escapeHtml(meta.commit_title);
        return `<div class="apexcharts-tooltip-box" style="padding: 8px 12px; max-width: 360px;">
                  <div><b>${style.icon} ${style.label}</b> · ${formatDuration(meta.duration)}</div>
                  <div style="color: #666; font-size: 11px;">${escapeHtml(meta.repo)} · ${escapeHtml(meta.date)}</div>
                  ${sha ? `<div style="font-family: monospace; font-size: 11px;">${sha}${title ? ' — ' + title : ''}</div>` : ''}
                </div>`;
      },
    },
  };
}

function dockerSeries(perTag, sizeField, cutoff) {
  // Iteration order is whatever the Python side wrote into github_action_data.json
  // — driven by TAGS in scripts/image_tags.py, the single source of truth.
  return Object.keys(perTag).map(tag => {
    const slice = withinWindow(perTag[tag] || [], cutoff);
    return {
      name: tag,
      data: slice.map(d => ({
        x: new Date(d.date).getTime(),
        y: d[sizeField] / 1000 / 1000 / 1000,
        digest: d.digest,
      })),
    };
  });
}

function durationOptions(title) {
  return {
    chart: {
      height: 500, type: 'line',
      zoom: { enabled: true },
      selection: { enabled: true },
      toolbar: { autoSelected: 'pan' },
    },
    dataLabels: { enabled: false },
    title: { text: title, align: 'left' },
    grid: { row: { colors: ['#f3f3f3', 'transparent'], opacity: 0.5 } },
    xaxis: { type: 'datetime' },
    yaxis: {
      min: 0,
      labels: { formatter: v => `${v.toFixed(2)}h` },
      title: { text: 'Duration' },
    },
    tooltip: { y: { formatter: v => `${v.toFixed(2)}h` } },
  };
}

function dockerSizeOptions(title) {
  return {
    chart: {
      height: 500, type: 'line',
      zoom: { enabled: true },
      toolbar: { autoSelected: 'pan' },
    },
    dataLabels: { enabled: false },
    title: { text: title, align: 'left' },
    xaxis: { type: 'datetime' },
    yaxis: {
      min: 0,
      labels: { formatter: v => `${v.toFixed(2)}GB` },
      title: { text: 'Size' },
    },
    tooltip: {
      custom: ({ series, seriesIndex, dataPointIndex, w }) => {
        const value = series[seriesIndex][dataPointIndex];
        const point = w.config.series[seriesIndex].data[dataPointIndex];
        const digest = point && point.digest;
        let digestStr = '';
        if (digest && digest.startsWith('sha256:')) {
          digestStr = `<br/>${digest.substring(0, 19)}...`;
        }
        return `<div class="apexcharts-tooltip-box" style="padding: 5px 10px;">
                  <span>${value.toFixed(2)}GB${digestStr}</span>
                </div>`;
      },
    },
  };
}

function buildAllSeries(cutoff) {
  return {
    repoSwimlane: repoSwimlaneSeries(
      rawData.repo_ci_runs || {}, cutoff),
    healthCheck: workflowSeries(
      rawData.workflow_time['health-check'], HEALTH_CHECK_JOBS, cutoff),
    dockerBuild: workflowSeries(
      rawData.workflow_time['docker-build-and-push'], DOCKER_BUILD_JOBS, cutoff),
    dockerCompressed: dockerSeries(
      rawData.docker_images, 'size_compressed', cutoff),
    dockerUncompressed: dockerSeries(
      rawData.docker_images, 'size_uncompressed', cutoff),
  };
}

function renderAll() {
  const cutoff = cutoffDate(currentDuration);
  const series = buildAllSeries(cutoff);
  charts.repoSwimlane.updateSeries(series.repoSwimlane, true);
  charts.healthCheck.updateSeries(series.healthCheck, true);
  charts.dockerBuild.updateSeries(series.dockerBuild, true);
  charts.dockerCompressed.updateSeries(series.dockerCompressed, true);
  charts.dockerUncompressed.updateSeries(series.dockerUncompressed, true);
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
    const series = buildAllSeries(cutoffDate(currentDuration));

    charts.repoSwimlane = new ApexCharts(
      document.querySelector('#repo-swimlane-chart'),
      { ...repoSwimlaneOptions(), series: series.repoSwimlane });
    charts.healthCheck = new ApexCharts(
      document.querySelector('#health-check-time-chart'),
      { ...durationOptions('Build duration'), series: series.healthCheck });
    charts.dockerBuild = new ApexCharts(
      document.querySelector('#docker-build-and-push-time-chart'),
      { ...durationOptions('Build duration'), series: series.dockerBuild });
    charts.dockerCompressed = new ApexCharts(
      document.querySelector('#docker-chart-compressed'),
      { ...dockerSizeOptions('Docker Image Size (compressed)'),
        series: series.dockerCompressed });
    charts.dockerUncompressed = new ApexCharts(
      document.querySelector('#docker-chart-uncompressed'),
      { ...dockerSizeOptions('Docker Image Size (uncompressed)'),
        series: series.dockerUncompressed });

    Object.values(charts).forEach(c => c.render());
    wireDurationButtons();
  });
