const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/main.js'), 'utf8');

function dashboard() {
  const table = {};
  const handlers = {};
  const opened = [];
  const context = vm.createContext({
    URLSearchParams,
    window: {
      location: { search: '?duration=7d&distro=jazzy' },
      open: (...args) => opened.push(args),
    },
    echarts: {
      init: element => ({ on: (event, handler) => { handlers[element] = handler; } }),
    },
    document: {
      documentElement: { getAttribute: () => 'light' },
      getElementById: () => table,
      querySelector: selector => selector,
    },
    // Load chart functions without starting the page's network/bootstrap work.
    fetch: () => new Promise(() => {}),
  });
  vm.runInContext(source, context);
  return { context, table, handlers, opened, evaluate: expression => vm.runInContext(expression, context) };
}

test('health-check plots separate Jazzy jobs and switches distro', () => {
  const { context, evaluate } = dashboard();
  context.runs = [{ date: '2026/09/09 16:05:38', jobs: {
    'main-humble-amd64': 4267,
    'main-humble-arm64': 2621,
    'nightly-humble-amd64': 5930,
    'main-jazzy-amd64': 5786,
    'main-jazzy-arm64': 3102,
  } }];
  const option = evaluate(`workflowLineOption('Build duration', runs,
    healthCheckJobNames(runs), new Date('2026/09/03 00:00:00'))`);
  assert.deepEqual(Array.from(option.series, s => s.name), ['main-jazzy-amd64', 'main-jazzy-arm64']);
  assert.equal(option.series[0].data[0].value[1], 5786 / 3600);
  assert.equal(option.graphic, undefined);
  evaluate("currentDistro = 'humble'");
  assert.equal(evaluate('healthCheckJobNames(runs).length'), 3);
  evaluate("currentDistro = 'all'");
  assert.equal(evaluate('healthCheckJobNames(runs).length'), 5);
});

test('health-check shows an empty state when no selected jobs have points', () => {
  const { evaluate } = dashboard();
  const option = evaluate(`workflowLineOption('Build duration',
    [{date: '2026/09/09', jobs: {'main-humble-amd64': 1000}}], [], null)`);
  assert.match(option.graphic.elements[0].style.text, /No runs/);
});

test('invalid compressed measurements cannot flatten valid image history to zero', () => {
  const { context, evaluate, table } = dashboard();
  context.images = {};
  for (const [index, flavor] of ['core', 'universe', 'universe-cuda'].entries()) {
    const tag = `${flavor}-dependencies-jazzy`;
    context.images[tag] = [
      { date: '2026/07/17', size_compressed: (index + 1) * 1e9, size_uncompressed: 4e9 },
      { date: '2026/07/22', size_compressed: 0, size_uncompressed: 5e9 },
    ];
  }
  const option = evaluate(`dockerSizeOption('Compressed', images, 'size_compressed',
    new Date('2026/09/03 00:00:00'))`);
  assert.equal(option.series.length, 3);
  option.series.forEach((series, index) => {
    assert.equal(series.data.length, 2); // Cutoff and current-time anchors.
    assert.ok(series.data.every(point => point.value[1] === index + 1));
  });
  evaluate("rawData = {docker_images: images}; renderImageSizeTable('table', 'size_compressed')");
  for (const size of ['1.00 GB', '2.00 GB', '3.00 GB']) assert.ok(table.innerHTML.includes(size));
  evaluate("renderImageSizeTable('table', 'size_uncompressed')");
  assert.ok(table.innerHTML.includes('5.00 GB'));
});

test('missing measurements display a dash and an empty chart, never zero GB', () => {
  const { context, evaluate, table } = dashboard();
  context.images = { 'core-dependencies-jazzy': [
    { date: '2026/09/09', size_compressed: 0 },
    { date: '2026/09/08', size_compressed: null },
    { date: '2026/09/07' },
  ] };
  const option = evaluate("dockerSizeOption('Compressed', images, 'size_compressed', null)");
  assert.equal(option.series[0].data.length, 0);
  assert.match(option.graphic.elements[0].style.text, /No image size measurements/);
  evaluate("rawData = {docker_images: images}; renderImageSizeTable('table', 'size_compressed')");
  assert.ok(table.innerHTML.includes('—'));
  assert.ok(!table.innerHTML.includes('0.00'));
});


test('clicking a health-check point opens its specific run', () => {
  const { context, evaluate, handlers, opened } = dashboard();
  const url = 'https://github.com/autowarefoundation/autoware/actions/runs/34374527860';
  context.runs = [{ date: '2026/09/09 16:05:38', html_url: url,
    jobs: { 'main-jazzy-amd64': 5786 } }];
  evaluate('createAllCharts()');
  const option = evaluate("workflowLineOption('Build duration', runs, healthCheckJobNames(runs), null)");
  handlers['#health-check-time-chart']({ data: option.series[0].data[0] });
  assert.deepEqual(opened, [[url, '_blank', 'noopener']]);
});

test('both image charts open recorded versions, including synthetic anchors', () => {
  const { context, evaluate, handlers, opened } = dashboard();
  const oldUrl = 'https://github.com/orgs/autowarefoundation/packages/container/autoware/101';
  const newUrl = 'https://github.com/orgs/autowarefoundation/packages/container/autoware/202';
  context.images = { 'core-dependencies-jazzy': [
    { date: '2026/09/01', size_compressed: 1e9, size_uncompressed: 3e9,
      digest: 'sha256:old', html_url: oldUrl },
    { date: '2026/09/09', size_compressed: 2e9, size_uncompressed: 4e9,
      digest: 'sha256:new', html_url: newUrl },
  ] };
  evaluate('createAllCharts()');
  for (const field of ['compressed', 'uncompressed']) {
    const option = evaluate(`dockerSizeOption('Size', images, 'size_${field}', new Date('2026/09/03'))`);
    assert.equal(option.series[0].data.length, 3);
    for (const point of option.series[0].data) {
      handlers[`#docker-chart-${field}`]({ data: point });
    }
  }
  assert.deepEqual(opened.map(args => args[0]), [oldUrl, newUrl, newUrl, oldUrl, newUrl, newUrl]);
  assert.ok(opened.every(args => args[1] === '_blank' && args[2] === 'noopener'));
});

test('missing historical version metadata opens the versions list with an explicit hint', () => {
  const { context, evaluate, handlers, opened } = dashboard();
  context.images = { 'core-dependencies-jazzy': [
    { date: '2026/09/09', size_compressed: 1e9 },
  ] };
  evaluate('createAllCharts()');
  const option = evaluate("dockerSizeOption('Size', images, 'size_compressed', null)");
  const point = option.series[0].data[0];
  handlers['#docker-chart-compressed']({ data: point });
  assert.equal(opened[0][0], 'https://github.com/orgs/autowarefoundation/packages/container/autoware/versions');
  assert.match(option.tooltip.formatter({data: point, value: point.value, seriesName: 'core-dependencies-jazzy'}), /Version link unavailable/);
  handlers['#docker-chart-compressed']({});
  assert.equal(opened.length, 1);
});
