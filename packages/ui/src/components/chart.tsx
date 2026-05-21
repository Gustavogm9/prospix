import { cn } from '../lib/cn.js';

export interface FunnelStage {
  label: string;
  count: number;
  percentage: number;
  value?: string;
}

export interface FunnelChartProps {
  stages: FunnelStage[];
  className?: string;
}

export const FunnelChart = ({ stages, className }: FunnelChartProps) => {
  return (
    <div className={cn('flex flex-col gap-3 w-full py-2', className)}>
      {stages.map((stage, idx) => {
        // Compute width based on percentage
        const widthPercent = `${stage.percentage}%`;
        return (
          <div key={idx} className="flex items-center gap-4 text-sm w-full">
            <span className="w-24 text-text-secondary truncate font-medium">{stage.label}</span>
            <div className="flex-1 bg-surface-sunken rounded-full h-8 overflow-hidden relative border border-border-subtle shadow-inner">
              <div
                className="bg-primary hover:bg-primary-hover transition-all duration-500 h-full rounded-full flex items-center justify-end px-3"
                style={{ width: widthPercent }}
              >
                {stage.percentage >= 15 && (
                  <span className="text-2xs font-semibold text-white font-mono">{stage.percentage}%</span>
                )}
              </div>
            </div>
            <div className="w-20 text-right">
              <span className="font-semibold text-text font-mono">{stage.count}</span>
              {stage.value && (
                <span className="text-2xs text-text-muted ml-1 block font-mono leading-none">{stage.value}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export interface BarChartItem {
  label: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  items: BarChartItem[];
  maxVal?: number;
  className?: string;
}

export const BarChart = ({ items, maxVal, className }: BarChartProps) => {
  const defaultMax = Math.max(...items.map((i) => i.value), 1);
  const finalMax = maxVal || defaultMax;

  return (
    <div className={cn('flex items-end justify-between gap-2 h-48 w-full pt-6 pb-2 px-4 border-b border-border', className)}>
      {items.map((item, idx) => {
        const heightPercent = `${(item.value / finalMax) * 100}%`;
        return (
          <div key={idx} className="flex flex-col items-center gap-2 group flex-1 h-full justify-end">
            <div className="relative w-full flex justify-center group-hover:scale-y-105 transition-transform duration-200">
              {/* Tooltip on hover */}
              <div className="absolute bottom-full mb-1 bg-text text-surface text-2xs font-semibold font-mono px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow z-10">
                {item.value}
              </div>
              <div
                className={cn('w-8 sm:w-12 rounded-t shadow-sm transition-all', item.color || 'bg-primary')}
                style={{ height: heightPercent }}
              />
            </div>
            <span className="text-2xs text-text-secondary text-center truncate w-full">{item.label}</span>
          </div>
        );
      })}
    </div>
  );
};
