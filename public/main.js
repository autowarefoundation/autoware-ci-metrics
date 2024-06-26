fetch('github_action_data.json')
  .then((res) => res.json())
  .then((json) => {
    const validatedWorkflowTime = json.workflow_time["build-main"].filter(
      (data) => 'build-main (no-cuda)' in data.jobs && 'build-main (cuda)' in data.jobs);
    const validatedWorkflowTimeSelfHosted = json.workflow_time["build-main-self-hosted"].filter(
      (data) => 'build-main-self-hosted (no-cuda)' in data.jobs && 'build-main-self-hosted (cuda)' in data.jobs);
    const packageList = new Set(
      validatedWorkflowTime.flatMap((data) => Object.keys(data.details ?? {})),
    );
    const mmss = (seconds) =>
      `${Math.ceil(seconds / 60)}m${(seconds % 60).toFixed(0)}s`;

    // Package duration chart
    const allPackageDurationOptions = {
      series: [],
      chart: {
        height: 500,
        type: 'donut',
        zoom: {
          enabled: true,
        },
        selection: {
          enabled: true,
        },
        events: {
          click: (_event, _chartContext, config) => {
            const dataPoint = config.dataPointIndex;
            if (dataPoint === undefined) {
              return;
            }
          },
        },
        animations: {
          enabled: false,
        },
      },
      dataLabels: {
        enabled: false,
      },
      title: {
        text: 'All package build duration',
        align: 'left',
      },
      tooltip: {
        y: {
          formatter: mmss,
        },
      },
    };

    const allPackageDurationChart = new ApexCharts(
      document.querySelector('#all-package-time-chart'),
      allPackageDurationOptions,
    );
    allPackageDurationChart.render();

    // Handler
    const showAllPackageDuration = (buildIndex) => {
      const packageDetails = validatedWorkflowTime[buildIndex].details ?? {};
      const packageLabels = Object.keys(packageDetails).sort(
        (a, b) => packageDetails[b] - packageDetails[a],
      );
      const packageData = packageLabels.map((label) => packageDetails[label]);

      const topPackageCount = 150;
      const topPackageLabels = packageLabels.slice(0, topPackageCount);
      const topPackageData = packageData.slice(0, topPackageCount);
      const remainingPackageSum = packageData
        .slice(30)
        .reduce((a, b) => a + b, 0);
      allPackageDurationChart.updateOptions({
        labels: [...topPackageLabels, 'Others'],
      });
      allPackageDurationChart.updateSeries([
        ...topPackageData,
        remainingPackageSum,
      ]);

      const buildSelector = document.querySelector('#build-select');
      buildSelector.value = buildIndex;
    };

    // Each package duration chart
    const multiPackageDurationOptions = {
      series: [],
      chart: {
        height: 350,
        type: 'line',
        zoom: {
          enabled: true,
        },
        selection: {
          enabled: true,
        },
        events: {
          click: (_event, _chartContext, config) => {
            const dataPoint = config.dataPointIndex;
            if (dataPoint === undefined) {
              return;
            }

            showAllPackageDuration(dataPoint);
          },
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
        labels: {
          formatter: (val) => val && mmss(val),
        },
        title: {
          text: 'Duration',
        },
      },
      tooltip: {
        y: {
          formatter: (val) => val && mmss(val),
        },
      },
    };

    const multiPackageDurationChart = new ApexCharts(
      document.querySelector('#package-time-chart'),
      multiPackageDurationOptions,
    );
    multiPackageDurationChart.render();

    // Handler
    const showPackageDuration = (packageName) => {
      const packageSelector = document.querySelector('#package-select');
      packageSelector.value = packageName;

      const packageData = validatedWorkflowTime.map((data) => [
        new Date(data.date),
        data.details?.[packageName] ?? null,
      ]);

      multiPackageDurationChart.updateSeries([
        {
          name: packageName,
          data: packageData,
        },
      ]);
    };

    // Build duration chart
    const buildDurationOptions = {
      series: [
        {
          name: 'build-main (no-cuda)',
          data: validatedWorkflowTime.map((data) => {
            return [new Date(data.date), data.jobs['build-main (no-cuda)'] / 3600.0];
          }),
        },
        {
          name: 'build-main (cuda)',
          data: validatedWorkflowTime.map((data) => {
            return [new Date(data.date), data.jobs['build-main (cuda)'] / 3600.0];
          }),
        },
        {
          name: 'build-main-self-hosted (no-cuda)',
          data: validatedWorkflowTimeSelfHosted.map((data) => {
            return [new Date(data.date), data.jobs['build-main-self-hosted (no-cuda)'] / 3600.0];
          }),
        },
        {
          name: 'build-main-self-hosted (cuda)',
          data: validatedWorkflowTimeSelfHosted.map((data) => {
            return [new Date(data.date), data.jobs['build-main-self-hosted (cuda)'] / 3600.0];
          }),
        },
      ],
      chart: {
        height: 350,
        type: 'line',
        zoom: {
          enabled: true,
        },
        selection: {
          enabled: true,
        },
        events: {
          click: (_event, _chartContext, config) => {
            const dataPoint = config.dataPointIndex;
            if (dataPoint === undefined) {
              return;
            }

            showAllPackageDuration(dataPoint);
          },
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

    // Build selector
    const buildSelector = document.querySelector('#build-select');
    validatedWorkflowTime.forEach((data, index) => {
      if (data.details !== null) {
        const option = document.createElement('option');
        option.value = index;
        option.text = `${data.date} (${data.duration.toFixed(2)}h)`;
        buildSelector.appendChild(option);
      }
    });

    buildSelector.addEventListener('change', (event) => {
      showAllPackageDuration(Number(event.target.value));
    });

    // Package selector
    const packageSelector = document.querySelector('#package-select');

    Array.from(packageList)
      .sort()
      .forEach((key) => {
        const option = document.createElement('option');
        option.value = key;
        option.text = `${key}`;
        packageSelector.appendChild(option);
      });

    packageSelector.addEventListener('change', (event) => {
      showPackageDuration(event.target.value);
    });

    // Docker
    const dockerOptions = {
      series: [
        {
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
        height: 350,
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
