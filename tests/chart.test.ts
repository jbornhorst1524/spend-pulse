import { describe, it, expect } from 'vitest';
import { renderSpendingChart, type ChartData } from '../src/lib/chart.js';

describe('chart', () => {
  const makeChartData = (overrides?: Partial<ChartData>): ChartData => {
    const currentCurve = new Map<number, number>();
    for (let d = 1; d <= 15; d++) {
      currentCurve.set(d, d * 200);
    }

    const lastMonthCurve = new Map<number, number>();
    for (let d = 1; d <= 31; d++) {
      lastMonthCurve.set(d, d * 250);
    }

    return {
      currentMonthCurve: currentCurve,
      lastMonthCurve,
      monthlyTarget: 8000,
      currentDay: 15,
      daysInMonth: 31,
      spent: 3000,
      remaining: 5000,
      monthLabel: '2026-02',
      ...overrides,
    };
  };

  it('should render a valid PNG buffer', async () => {
    const data = makeChartData();
    const buffer = await renderSpendingChart(data);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);

    // Check PNG magic bytes
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50); // P
    expect(buffer[2]).toBe(0x4E); // N
    expect(buffer[3]).toBe(0x47); // G
  });

  it('should render without last month data', async () => {
    const data = makeChartData({ lastMonthCurve: null });
    const buffer = await renderSpendingChart(data);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('should render with different month labels', async () => {
    const data = makeChartData({ monthLabel: '2026-12' });
    const buffer = await renderSpendingChart(data);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
