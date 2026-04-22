const DURATION_DAYS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
  'all': null,
};

const HEALTH_CHECK_JOBS = ['main-amd64', 'main-arm64', 'nightly-amd64'];
// docker-build-and-push tracks one wall-clock total per push-to-main run.
const DOCKER_BUILD_JOBS = ['total'];

let rawData = null;
let charts = {};
let currentDuration = '90d';

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
    chart: { height: 500, type: 'line', zoom: { enabled: true } },
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
