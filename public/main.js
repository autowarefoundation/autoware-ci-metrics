fetch('github_action_data.json')
  .then((res) => res.json())
  .then((json) => {
    const healthCheck = json.workflow_time["health-check"];
    const dockerBuildAndPush = json.workflow_time["docker-build-and-push"];

    // Build duration chart
    const healthCheckTimeOptions = {
      series: [
        {
          name: 'main-amd64',
          data: healthCheck.map((data) => {
            if (!data.jobs['main-amd64']) return null;
            return [new Date(data.date), data.jobs['main-amd64'] / 3600.0];
          }).filter(item => item !== null && item[1] > 0),
        },
        {
          name: 'main-arm64',
          data: healthCheck.map((data) => {
            if (!data.jobs['main-arm64']) return null;
            return [new Date(data.date), data.jobs['main-arm64'] / 3600.0];
          }).filter(item => item !== null && item[1] > 0),
        },
        {
          name: 'nightly-amd64',
          data: healthCheck.map((data) => {
            if (!data.jobs['nightly-amd64']) return null;
            return [new Date(data.date), data.jobs['nightly-amd64'] / 3600.0];
          }).filter(item => item !== null && item[1] > 0),
        },
      ],
      chart: {
        height: 500,
        type: 'line',
        zoom: {
          enabled: true,
        },
        selection: {
          enabled: true,
        },
      },
      dataLabels: {
        enabled: false,
      },
      title: {
        text: 'Build duration',
        align: 'left',
      },
      grid: {
        row: {
          colors: ['#f3f3f3', 'transparent'], // takes an array which will be repeated on columns
          opacity: 0.5,
        },
      },
      xaxis: {
        type: 'datetime',
      },
      yaxis: {
        min: 0,
        labels: {
          formatter: (val) => `${val.toFixed(2)}h`,
        },
        title: {
          text: 'Duration',
        },
      },
      tooltip: {
        y: {
          formatter: function (val) {
            return `${val.toFixed(2)}h`;
          },
        },
      },
    };

    const healthCheckTimeChart = new ApexCharts(
      document.querySelector('#health-check-time-chart'),
      healthCheckTimeOptions,
    );
    healthCheckTimeChart.render();

    const dockerBuildAndPushTimeOptions = {
      series: [
        {
          name: 'main-amd64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['main-amd64']) return null;
            return [new Date(data.date), data.jobs['main-amd64'] / 3600.0];
          }).filter(item => item !== null && item[1] > 0),
        },
        {
          name: 'main-arm64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['main-arm64']) return null;
            return [new Date(data.date), data.jobs['main-arm64'] / 3600.0];
          }).filter(item => item !== null && item[1] > 0),
        },
        {
          name: 'cuda-amd64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['cuda-amd64']) return null;
            return [new Date(data.date), data.jobs['cuda-amd64'] / 3600.0];
          }).filter(item => item !== null && item[1] > 0),
        },
        {
          name: 'cuda-arm64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['cuda-arm64']) return null;
            return [new Date(data.date), data.jobs['cuda-arm64'] / 3600.0];
          }).filter(item => item !== null && item[1] > 0),
        },
        {
          name: 'tools-amd64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['tools-amd64']) return null;
            return [new Date(data.date), data.jobs['tools-amd64'] / 3600.0];
          }).filter(item => item !== null && item[1] > 0),
        },
        {
          name: 'tools-arm64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['tools-arm64']) return null;
            return [new Date(data.date), data.jobs['tools-arm64'] / 3600.0];
          }).filter(item => item !== null && item[1] > 0),
        },
      ],
      chart: {
        height: 500,
        type: 'line',
        zoom: {
          enabled: true,
        },
        selection: {
          enabled: true,
        },
      },
      dataLabels: {
        enabled: false,
      },
      title: {
        text: 'Build duration',
        align: 'left',
      },
      grid: {
        row: {
          colors: ['#f3f3f3', 'transparent'], // takes an array which will be repeated on columns
          opacity: 0.5,
        },
      },
      xaxis: {
        type: 'datetime',
      },
      yaxis: {
        min: 0,
        labels: {
          formatter: (val) => `${val.toFixed(2)}h`,
        },
        title: {
          text: 'Duration',
        },
      },
      tooltip: {
        y: {
          formatter: function (val) {
            return `${val.toFixed(2)}h`;
          },
        },
      },
    };

    const dockerBuildAndPushTimeChart = new ApexCharts(
      document.querySelector('#docker-build-and-push-time-chart'),
      dockerBuildAndPushTimeOptions,
    );
    dockerBuildAndPushTimeChart.render();

    // Docker image size chart (compressed)
    const dockerCompressedData = {
      'core-devel': json.docker_images['core-devel'],
      'universe-devel': json.docker_images['universe-devel'],
      'universe-devel-cuda': json.docker_images['universe-devel-cuda'],
    };

    const dockerCompressedOptions = {
      series: [
        {
          name: 'core-devel',
          data: json.docker_images['core-devel'].map((data) => {
            return [new Date(data.date), data.size_compressed / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-devel',
          data: json.docker_images['universe-devel'].map((data) => {
            return [new Date(data.date), data.size_compressed / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-devel-cuda',
          data: json.docker_images['universe-devel-cuda'].map((data) => {
            return [new Date(data.date), data.size_compressed / 1024 / 1024 / 1024];
          }),
        },
      ],
      chart: {
        height: 500,
        type: 'line',
        zoom: {
          enabled: true,
        },
      },
      dataLabels: {
        enabled: false,
      },
      title: {
        text: 'Docker Image Size (compressed)',
        align: 'left',
      },
      xaxis: {
        type: 'datetime',
      },
      yaxis: {
        min: 0,
        labels: {
          formatter: (val) => `${val.toFixed(2)}GB`,
        },
        title: {
          text: 'Size',
        },
      },
      tooltip: {
        custom: function({ series, seriesIndex, dataPointIndex, w }) {
          const seriesName = w.config.series[seriesIndex].name;
          const value = series[seriesIndex][dataPointIndex];
          const digest = dockerCompressedData[seriesName][dataPointIndex].digest;

          let digestStr = '';
          if (digest && digest.startsWith('sha256:')) {
            const truncated = digest.substring(0, 19); // "sha256:" (7 chars) + 12 chars = 19
            digestStr = `<br/>${truncated}...`;
          }

          return `<div class="apexcharts-tooltip-box" style="padding: 5px 10px;">
                    <span>${value.toFixed(2)}GB${digestStr}</span>
                  </div>`;
        },
      },
    };

    const dockerChartCompressed = new ApexCharts(
      document.querySelector('#docker-chart-compressed'),
      dockerCompressedOptions,
    );
    dockerChartCompressed.render();

    // Docker image size chart (uncompressed)
    const dockerUncompressedData = {
      'core-devel': json.docker_images['core-devel'],
      'universe-devel': json.docker_images['universe-devel'],
      'universe-devel-cuda': json.docker_images['universe-devel-cuda'],
    };

    const dockerUncompressedOptions = {
      series: [
        {
          name: 'core-devel',
          data: json.docker_images['core-devel'].map((data) => {
            return [new Date(data.date), data.size_uncompressed / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-devel',
          data: json.docker_images['universe-devel'].map((data) => {
            return [new Date(data.date), data.size_uncompressed / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-devel-cuda',
          data: json.docker_images['universe-devel-cuda'].map((data) => {
            return [new Date(data.date), data.size_uncompressed / 1024 / 1024 / 1024];
          }),
        },
      ],
      chart: {
        height: 500,
        type: 'line',
        zoom: {
          enabled: true,
        },
      },
      dataLabels: {
        enabled: false,
      },
      title: {
        text: 'Docker Image Size (uncompressed)',
        align: 'left',
      },
      xaxis: {
        type: 'datetime',
      },
      yaxis: {
        min: 0,
        labels: {
          formatter: (val) => `${val.toFixed(2)}GB`,
        },
        title: {
          text: 'Size',
        },
      },
      tooltip: {
        custom: function({ series, seriesIndex, dataPointIndex, w }) {
          const seriesName = w.config.series[seriesIndex].name;
          const value = series[seriesIndex][dataPointIndex];
          const digest = dockerUncompressedData[seriesName][dataPointIndex].digest;

          let digestStr = '';
          if (digest && digest.startsWith('sha256:')) {
            const truncated = digest.substring(0, 19); // "sha256:" (7 chars) + 12 chars = 19
            digestStr = `<br/>${truncated}...`;
          }

          return `<div class="apexcharts-tooltip-box" style="padding: 5px 10px;">
                    <span>${value.toFixed(2)}GB${digestStr}</span>
                  </div>`;
        },
      },
    };

    const dockerChartUncompressed = new ApexCharts(
      document.querySelector('#docker-chart-uncompressed'),
      dockerUncompressedOptions,
    );
    dockerChartUncompressed.render();
  });
