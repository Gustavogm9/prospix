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

  return (
    <div className={cn('flex items-end justify-between gap-3 w-full h-full', className)}>
      {items.map((item, idx) => {
        // Calculate height as percentage (min 15% for non-zero, max 100%)
        const pct = item.value > 0 ? Math.max(15, (item.value / finalMax) * 100) : 0;

        return (
          <div key={idx} className="flex flex-col items-center flex-1 h-full min-w-0">
            {/* Value label - fixed area */}
            <div
              className="text-[11px] font-bold font-mono text-center shrink-0 mb-1"
              style={{ color: item.value > 0 ? (item.color || '#1B3A6B') : '#94A3B8' }}
            >
              {item.value}
            </div>
            {/* Bar area - grows to fill remaining space */}
            <div className="flex-1 w-full flex items-end justify-center overflow-hidden min-h-0">
              {item.value > 0 ? (
                <div
                  className={cn(
                    'w-8 sm:w-10 rounded-t-md shadow-sm transition-all duration-500 ease-out',
                    !item.color && 'bg-primary',
                  )}
                  style={{
                    height: `${pct}%`,
                    backgroundColor: item.color || undefined,
                  }}
                />
              ) : (
                <div className="w-8 sm:w-10 h-[3px] rounded-full bg-[#E2E8F0] mb-0" />
              )}
            </div>
            {/* Day label + sublabel - fixed area */}
            <div className="flex flex-col items-center shrink-0 mt-1.5 border-t border-[#EEF0F3] pt-1 w-full">
              <span className="text-[11px] font-semibold text-[#475569] text-center truncate w-full leading-tight">
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
