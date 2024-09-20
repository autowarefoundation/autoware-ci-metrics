fetch('github_action_data.json')
  .then((res) => res.json())
  .then((json) => {
    const healthCheck = json.workflow_time["health-check"].filter(
      (data) => 'no-cuda' in data.jobs && 'cuda' in data.jobs);
    const healthCheckSelfHosted = json.workflow_time["health-check-self-hosted"].filter(
      (data) => 'no-cuda' in data.jobs && 'cuda' in data.jobs);
    const dockerBuildAndPush = json.workflow_time["docker-build-and-push"].filter(
      (data) => 'no-cuda' in data.jobs && 'cuda' in data.jobs);
    const dockerBuildAndPushSelfHosted = json.workflow_time["docker-build-and-push-self-hosted"].filter(
      (data) => 'no-cuda' in data.jobs && 'cuda' in data.jobs);

    // Build duration chart
    const healthCheckTimeOptions = {
      series: [
        {
          name: 'health-check (no-cuda)',
          data: healthCheck.map((data) => {
            return [new Date(data.date), data.jobs['no-cuda'] / 3600.0];
          }),
        },
        {
          name: 'health-check (cuda)',
          data: healthCheck.map((data) => {
            return [new Date(data.date), data.jobs['cuda'] / 3600.0];
          }),
        },
        {
          name: 'health-check-arm64 (no-cuda)',
          data: healthCheckSelfHosted.map((data) => {
            return [new Date(data.date), data.jobs['no-cuda'] / 3600.0];
          }),
        },
        {
          name: 'health-check-arm64 (cuda)',
          data: healthCheckSelfHosted.map((data) => {
            return [new Date(data.date), data.jobs['cuda'] / 3600.0];
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
          name: 'docker-build-and-push (no-cuda)',
          data: dockerBuildAndPush.map((data) => {
            return [new Date(data.date), data.jobs['no-cuda'] / 3600.0];
          }),
        },
        {
          name: 'docker-build-and-push (cuda)',
          data: dockerBuildAndPush.map((data) => {
            return [new Date(data.date), data.jobs['cuda'] / 3600.0];
          }),
        },
        {
          name: 'docker-build-and-push-arm64 (no-cuda)',
          data: dockerBuildAndPushSelfHosted.map((data) => {
            return [new Date(data.date), data.jobs['no-cuda'] / 3600.0];
          }),
        },
        {
          name: 'docker-build-and-push-arm64 (cuda)',
          data: dockerBuildAndPushSelfHosted.map((data) => {
            return [new Date(data.date), data.jobs['cuda'] / 3600.0];
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
          name: 'base',
          data: json.docker_images['base'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
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

    const dockerCudaOptions = {
      series: [
        {
          name: 'base-cuda',
          data: json.docker_images['base-cuda'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'core-cuda',
          data: json.docker_images['core-cuda'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'core-devel-cuda',
          data: json.docker_images['core-devel-cuda'].map((data) => {
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
          name: 'universe-localization-mapping-cuda',
          data: json.docker_images['universe-localization-mapping-cuda'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-localization-mapping-devel-cuda',
          data: json.docker_images['universe-localization-mapping-devel-cuda'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-planning-control-cuda',
          data: json.docker_images['universe-planning-control-cuda'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'universe-planning-control-devel-cuda',
          data: json.docker_images['universe-planning-control-devel-cuda'].map((data) => {
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

    const dockerCudaChart = new ApexCharts(
      document.querySelector('#docker-cuda-chart'),
      dockerCudaOptions,
    );
    dockerCudaChart.render();
  });
