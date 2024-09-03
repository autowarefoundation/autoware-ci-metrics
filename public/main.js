fetch('github_action_data.json')
  .then((res) => res.json())
  .then((json) => {
    const healthCheck = json.workflow_time["health-check"].filter(
      (data) => 'no-cuda' in data.jobs && 'cuda' in data.jobs);
    const healthCheckSelfHosted = json.workflow_time["health-check-self-hosted"].filter(
      (data) => 'no-cuda' in data.jobs && 'cuda' in data.jobs);
    const dockerBuildAndPush = json.workflow_time["docker-build-and-push"].filter(
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
          name: 'health-check-self-hosted (no-cuda)',
          data: healthCheckSelfHosted.map((data) => {
            return [new Date(data.date), data.jobs['no-cuda'] / 3600.0];
          }),
        },
        {
          name: 'health-check-self-hosted (cuda)',
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
          name: 'base-amd64',
          data: json.docker_images['base-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'autoware-core-amd64',
          data: json.docker_images['autoware-core-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'autoware-universe-amd64',
          data: json.docker_images['autoware-universe-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'devel-amd64',
          data: json.docker_images['devel-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'runtime-amd64',
          data: json.docker_images['runtime-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        // {
        //   name: 'base-arm64',
        //   data: json.docker_images['base-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
        // {
        //   name: 'autoware-core-arm64',
        //   data: json.docker_images['autoware-core-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
        // {
        //   name: 'autoware-universe-arm64',
        //   data: json.docker_images['autoware-universe-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
        // {
        //   name: 'devel-arm64',
        //   data: json.docker_images['devel-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
        // {
        //   name: 'runtime-arm64',
        //   data: json.docker_images['runtime-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
        {
          name: 'base-cuda-amd64',
          data: json.docker_images['base-cuda-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'autoware-core-cuda-amd64',
          data: json.docker_images['autoware-core-cuda-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'autoware-universe-cuda-amd64',
          data: json.docker_images['autoware-universe-cuda-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'devel-cuda-amd64',
          data: json.docker_images['devel-cuda-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'runtime-cuda-amd64',
          data: json.docker_images['runtime-cuda-amd64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        // {
        //   name: 'base-cuda-arm64',
        //   data: json.docker_images['base-cuda-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
        // {
        //   name: 'autoware-core-cuda-arm64',
        //   data: json.docker_images['autoware-core-cuda-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
        // {
        //   name: 'autoware-universe-cuda-arm64',
        //   data: json.docker_images['autoware-universe-cuda-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
        // {
        //   name: 'devel-cuda-arm64',
        //   data: json.docker_images['devel-cuda-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
        // {
        //   name: 'runtime-cuda-arm64',
        //   data: json.docker_images['runtime-cuda-arm64'].map((data) => {
        //     return [new Date(data.date), data.size / 1024 / 1024 / 1024];
        //   }),
        // },
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
