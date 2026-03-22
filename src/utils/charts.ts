import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface SparklineConfig {
  container: HTMLElement;
  data: [number[], number[]];
  color: string;
  width?: number;
  height?: number;
}

export function createSparkline(config: SparklineConfig): uPlot {
  const opts: uPlot.Options = {
    width: config.width || 120,
    height: config.height || 40,
    cursor: { show: false },
    legend: { show: false },
    axes: [
      { show: false }, // x
      { show: false }  // y
    ],
    series: [
      {},
      {
        stroke: config.color,
        fill: `${config.color}33`, // 20% opacity hex
        width: 2,
        points: { show: false }
      }
    ]
  };

  return new uPlot(opts, config.data, config.container);
}
