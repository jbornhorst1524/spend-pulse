import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { ChartConfiguration, Plugin } from 'chart.js';

export interface ChartData {
  currentMonthCurve: Map<number, number>;
  lastMonthCurve: Map<number, number> | null;
  monthlyTarget: number;
  currentDay: number;
  daysInMonth: number;
  spent: number;
  remaining: number;
  monthLabel: string; // "YYYY-MM"
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function formatMonthLabel(monthStr: string): string {
  const [year, mon] = monthStr.split('-').map(Number);
  return `${MONTH_NAMES[mon - 1]} ${year}`;
}

function formatDollars(amount: number): string {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`.replace('.0k', 'k');
  }
  return `$${Math.round(amount)}`;
}

export async function renderSpendingChart(data: ChartData): Promise<Buffer> {
  const width = 900;
  const height = 520;

  // Gradient fill plugin — draws a vertical gradient under the current month line
  const gradientFillPlugin: Plugin<'line'> = {
    id: 'gradientFill',
    beforeDatasetsDraw(chart) {
      const dataset = chart.data.datasets[0];
      if (!dataset) return;
      const ctx = chart.ctx;
      const chartArea = chart.chartArea;
      const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0.18)');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
      dataset.backgroundColor = gradient;
    },
  };

  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: '#FAFBFC',
  });

  const days = Array.from({ length: data.daysInMonth }, (_, i) => i + 1);

  // Current month: only up to today, with a dot on the last point
  const currentData = days.map(d => {
    if (d > data.currentDay) return null;
    return data.currentMonthCurve.get(d) ?? null;
  });
  const currentPointRadius = days.map(d => d === data.currentDay ? 6 : 0);
  const currentPointBgColor = days.map(d => d === data.currentDay ? '#2563EB' : 'transparent');

  // Last month: full month
  const lastMonthData = data.lastMonthCurve
    ? days.map(d => data.lastMonthCurve!.get(d) ?? null)
    : null;

  // Budget target: horizontal line
  const targetData = days.map(() => data.monthlyTarget);

  // Y-axis: fit all data with headroom. If last month blew past budget,
  // showing that contrast is the whole point of the chart.
  const lastMonthMax = lastMonthData
    ? Math.max(...lastMonthData.filter((v): v is number => v !== null), 0)
    : 0;
  const yMax = Math.max(data.monthlyTarget * 1.15, data.spent * 1.3, lastMonthMax * 1.08);
  // Round up to a clean number
  const yMaxRounded = Math.ceil(yMax / 1000) * 1000;

  const monthName = formatMonthLabel(data.monthLabel);

  const datasets: ChartConfiguration<'line'>['data']['datasets'] = [
    {
      label: formatMonthLabel(data.monthLabel).split(' ')[0], // "February"
      data: currentData as (number | null)[],
      borderColor: '#2563EB',
      backgroundColor: 'rgba(59, 130, 246, 0.12)', // fallback, overridden by plugin
      borderWidth: 3,
      fill: true,
      pointRadius: currentPointRadius,
      pointBackgroundColor: currentPointBgColor,
      pointBorderColor: days.map(d => d === data.currentDay ? '#fff' : 'transparent'),
      pointBorderWidth: days.map(d => d === data.currentDay ? 2.5 : 0),
      pointHoverRadius: 0,
      spanGaps: true,
      tension: 0.15,
    },
    {
      label: 'Budget',
      data: targetData,
      borderColor: 'rgba(234, 179, 8, 0.8)',
      borderWidth: 2,
      borderDash: [6, 4],
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 0,
    },
  ];

  if (lastMonthData) {
    datasets.splice(1, 0, {
      label: 'Last Month',
      data: lastMonthData as (number | null)[],
      borderColor: 'rgba(156, 163, 175, 0.7)',
      borderWidth: 2,
      borderDash: [4, 3],
      fill: false,
      pointRadius: 0,
      pointHoverRadius: 0,
      spanGaps: true,
      tension: 0.15,
    });
  }

  const configuration: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: days.map(String),
      datasets,
    },
    plugins: [gradientFillPlugin],
    options: {
      responsive: false,
      layout: {
        padding: { top: 24, right: 28, bottom: 12, left: 12 },
      },
      plugins: {
        title: {
          display: false,
        },
        legend: {
          display: true,
          position: 'bottom',
          align: 'center',
          labels: {
            font: { size: 12, family: 'system-ui, -apple-system, sans-serif' },
            usePointStyle: true,
            pointStyleWidth: 10,
            padding: 24,
            color: '#6B7280',
          },
        },
      },
      scales: {
        x: {
          border: { display: false },
          ticks: {
            maxTicksLimit: 10,
            font: { size: 11, family: 'system-ui, -apple-system, sans-serif' },
            color: '#9CA3AF',
            padding: 8,
          },
          grid: {
            display: false,
          },
        },
        y: {
          border: { display: false },
          max: yMaxRounded,
          ticks: {
            maxTicksLimit: 6,
            font: { size: 11, family: 'system-ui, -apple-system, sans-serif' },
            color: '#9CA3AF',
            padding: 8,
            callback: (value) => {
              const num = Number(value);
              if (num === 0) return '$0';
              if (num >= 1000) return `$${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}k`;
              return `$${num}`;
            },
          },
          beginAtZero: true,
          grid: {
            color: 'rgba(229, 231, 235, 0.6)',
            lineWidth: 1,
          },
        },
      },
    },
  };

  return await chartJSNodeCanvas.renderToBuffer(configuration);
}
