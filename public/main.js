fetch('github_action_data.json')
  .then((res) => res.json())
  .then((json) => {
    const validatedWorkflowTime = json.workflow_time["health-check"].filter(
      (data) => 'no-cuda' in data.jobs && 'cuda' in data.jobs);
    const validatedWorkflowTimeSelfHosted = json.workflow_time["health-check-self-hosted"].filter(
      (data) => 'no-cuda' in data.jobs && 'cuda' in data.jobs);
    const packageList = new Set(
      validatedWorkflowTime.flatMap((data) => Object.keys(data.details ?? {})),
    );
    const mmss = (seconds) =>
      `${Math.ceil(seconds / 60)}m${(seconds % 60).toFixed(0)}s`;

    // Build duration chart
    const buildDurationOptions = {
      series: [
        {
          name: 'health-check (no-cuda)',
          data: validatedWorkflowTime.map((data) => {
            return [new Date(data.date), data.jobs['no-cuda'] / 3600.0];
          }),
        },
        {
          name: 'health-check (cuda)',
          data: validatedWorkflowTime.map((data) => {
            return [new Date(data.date), data.jobs['cuda'] / 3600.0];
          }),
        },
        {
          name: 'health-check-self-hosted (no-cuda)',
          data: validatedWorkflowTimeSelfHosted.map((data) => {
            return [new Date(data.date), data.jobs['no-cuda'] / 3600.0];
          }),
        },
        {
          name: 'health-check-self-hosted (cuda)',
          data: validatedWorkflowTimeSelfHosted.map((data) => {
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

    const buildDurationChart = new ApexCharts(
      document.querySelector('#build-time-chart'),
      buildDurationOptions,
    );
    buildDurationChart.render();

    // Docker
    const dockerOptions = {
      series: [
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
          // Obsolete
          name: 'prebuilt-cuda-amd64',
          data: json.docker_images['prebuilt-cuda-amd64'].map((data) => {
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
        {
          name: 'autoware-core-cuda-arm64',
          data: json.docker_images['autoware-core-cuda-arm64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'autoware-universe-cuda-arm64',
          data: json.docker_images['autoware-universe-cuda-arm64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          // Obsolete
          name: 'prebuilt-cuda-arm64',
          data: json.docker_images['prebuilt-cuda-arm64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'devel-cuda-arm64',
          data: json.docker_images['devel-cuda-arm64'].map((data) => {
            return [new Date(data.date), data.size / 1024 / 1024 / 1024];
          }),
        },
        {
          name: 'runtime-cuda-arm64',
          data: json.docker_images['runtime-cuda-arm64'].map((data) => {
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
