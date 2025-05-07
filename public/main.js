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
          }),
        },
        {
          name: 'main-arm64',
          data: healthCheck.map((data) => {
            if (!data.jobs['main-arm64']) return null;
            return [new Date(data.date), data.jobs['main-arm64'] / 3600.0];
          }),
        },
        {
          name: 'nightly-amd64',
          data: healthCheck.map((data) => {
            if (!data.jobs['nightly-amd64']) return null;
            return [new Date(data.date), data.jobs['nightly-amd64'] / 3600.0];
          }),
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
          }),
        },
        {
          name: 'main-arm64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['main-arm64']) return null;
            return [new Date(data.date), data.jobs['main-arm64'] / 3600.0];
          }),
        },
        {
          name: 'cuda-amd64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['cuda-amd64']) return null;
            return [new Date(data.date), data.jobs['cuda-amd64'] / 3600.0];
          }),
        },
        {
          name: 'cuda-arm64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['cuda-arm64']) return null;
            return [new Date(data.date), data.jobs['cuda-arm64'] / 3600.0];
          }),
        },
        {
          name: 'tools-amd64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['tools-amd64']) return null;
            return [new Date(data.date), data.jobs['tools-amd64'] / 3600.0];
          }),
        },
        {
          name: 'tools-arm64',
          data: dockerBuildAndPush.map((data) => {
            if (!data.jobs['tools-arm64']) return null;
            return [new Date(data.date), data.jobs['tools-arm64'] / 3600.0];
          }),
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

    // Docker
    const dockerOptions = {
      series: [
        {
          name: 'core',
          data: json.docker_images['core'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'core-devel',
          data: json.docker_images['core-devel'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'core-common-devel',
          data: json.docker_images['core-common-devel'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-sensing-perception',
          data: json.docker_images['universe-sensing-perception'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-sensing-perception-devel',
          data: json.docker_images['universe-sensing-perception-devel'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-localization-mapping',
          data: json.docker_images['universe-localization-mapping'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-localization-mapping-devel',
          data: json.docker_images['universe-localization-mapping-devel'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-planning-control',
          data: json.docker_images['universe-planning-control'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-planning-control-devel',
          data: json.docker_images['universe-planning-control-devel'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-visualization',
          data: json.docker_images['universe-visualization'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-visualization-devel',
          data: json.docker_images['universe-visualization-devel'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe',
          data: json.docker_images['universe'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-devel',
          data: json.docker_images['universe-devel'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-common-devel',
          data: json.docker_images['universe-common-devel'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-sensing-perception-cuda',
          data: json.docker_images['universe-sensing-perception-cuda'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-sensing-perception-devel-cuda',
          data: json.docker_images['universe-sensing-perception-devel-cuda'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-cuda',
          data: json.docker_images['universe-cuda'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-devel-cuda',
          data: json.docker_images['universe-devel-cuda'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
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
        text: 'Docker Image Size',
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
        y: {
          formatter: function (val) {
            return `${val.toFixed(2)}GB`;
          },
        },
      },
    };

    const dockerChart = new ApexCharts(
      document.querySelector('#docker-chart'),
      dockerOptions,
    );
    dockerChart.render();
  });
