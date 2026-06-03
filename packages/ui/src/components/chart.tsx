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
  sublabel?: string;
  value: number;
  color?: string;
}

export interface BarChartProps {
  items: BarChartItem[];
  maxVal?: number;
  className?: string;
}

export const BarChart = ({ items, maxVal, className }: BarChartProps) => {
  const allValues = items.map((i) => i.value);
  const dataMax = Math.max(...allValues, 1);
  const finalMax = maxVal || dataMax;

  // Constants for better visual scaling
  const CONTAINER_HEIGHT = 192; // h-48 = 12rem = 192px
  const MIN_BAR_PX = 24; // minimum visible bar height in px for non-zero values
  const LABEL_AREA = 32; // space reserved for the value label above
  const USABLE_HEIGHT = CONTAINER_HEIGHT - LABEL_AREA;

  return (
    <div className={cn('flex items-end justify-between gap-3 h-48 w-full pt-6 pb-2 px-4 border-b border-border', className)}>
      {items.map((item, idx) => {
        // Calculate bar height: ensure minimum visibility + proportional scaling
        let barHeight = 0;
        if (item.value > 0) {
          const ratio = item.value / finalMax;
          // Scale between MIN_BAR_PX and USABLE_HEIGHT
          barHeight = MIN_BAR_PX + ratio * (USABLE_HEIGHT - MIN_BAR_PX);
        }

        return (
          <div key={idx} className="flex flex-col items-center gap-1 group flex-1 h-full justify-end">
            {/* Always-visible value label */}
            <div
              className="text-xs font-bold font-mono text-center transition-all duration-300"
              style={{ color: item.value > 0 ? (item.color || '#1B3A6B') : '#94A3B8' }}
            >
              {item.value}
            </div>
            {/* Bar */}
            <div className="relative w-full flex justify-center group-hover:scale-y-[1.03] transition-transform duration-200 origin-bottom">
              {item.value > 0 ? (
                <div
                  className={cn(
                    'w-9 sm:w-12 rounded-t-md shadow-sm transition-all duration-500 ease-out',
                    !item.color && 'bg-primary',
                  )}
                  style={{
                    height: `${barHeight}px`,
                    backgroundColor: item.color || undefined,
                    minHeight: `${MIN_BAR_PX}px`,
                  }}
                />
              ) : (
                <div className="w-9 sm:w-12 h-[3px] rounded-full bg-[#E2E8F0]" />
              )}
            </div>
            {/* Day label + sublabel */}
            <div className="flex flex-col items-center mt-0.5">
              <span className="text-xs font-semibold text-text-secondary text-center truncate w-full">
                {item.label}
              </span>
              {item.sublabel && (
                <span className="text-[10px] text-[#94A3B8] font-mono leading-tight">
                  {item.sublabel}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
