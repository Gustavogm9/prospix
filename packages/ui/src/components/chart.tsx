import { cn } from '../lib/cn.js';

export interface FunnelStage {
  label: string;
  count: number;
  percentage: number;
  value?: string;
  color?: string;
}

export interface FunnelChartProps {
  stages: FunnelStage[];
  className?: string;
}

export const FunnelChart = ({ stages, className }: FunnelChartProps) => {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);
  
  // Find a nice upper bound for the X axis
  let roundedMax = 10;
  if (maxCount > 1000) {
    roundedMax = Math.ceil(maxCount / 500) * 500;
  } else if (maxCount > 100) {
    roundedMax = Math.ceil(maxCount / 100) * 100;
  } else if (maxCount > 10) {
    roundedMax = Math.ceil(maxCount / 10) * 10;
  } else {
    roundedMax = Math.ceil(maxCount);
  }
  
  const ticks = [
    0,
    Math.round(roundedMax * 0.25),
    Math.round(roundedMax * 0.5),
    Math.round(roundedMax * 0.75),
    roundedMax
  ];

  return (
    <div className={cn("w-full flex flex-col pt-1 pb-2", className)}>
      {/* Grid container with Y-axis and bars */}
      <div className="relative flex flex-col gap-3 w-full">
        {/* Vertical Grid Lines in background */}
        <div className="absolute inset-y-0 left-[125px] right-0 flex justify-between pointer-events-none">
          {ticks.map((_, idx) => (
            <div key={idx} className="h-full w-px bg-slate-100/70 first:bg-slate-300" />
          ))}
        </div>

        {stages.map((stage, idx) => {
          // Calculate width relative to roundedMax
          const widthPercent = `${Math.min(100, (stage.count / roundedMax) * 100)}%`;
          
          return (
            <div key={idx} className="relative z-10 flex items-center w-full min-h-[24px]">
              {/* Y-axis Label */}
              <span className="w-[115px] text-right pr-3.5 text-[11px] font-semibold text-slate-500 truncate leading-tight">
                {stage.label}
              </span>
              
              {/* Bar Area */}
              <div className="flex-1 h-5 flex items-center relative">
                {stage.count > 0 ? (
                  <div
                    className="h-[18px] rounded-r-[4px] shadow-sm hover:opacity-90 transition-all duration-300 ease-out cursor-help group flex items-center justify-end pr-2"
                    style={{
                      width: widthPercent,
                      backgroundColor: stage.color || '#1B3A6B'
                    }}
                  >
                    {/* Percentage inside bar if space permits */}
                    {stage.percentage >= 15 && (
                      <span className="text-[9px] font-bold text-white font-mono leading-none drop-shadow-sm select-none">
                        {stage.percentage}%
                      </span>
                    )}
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block bg-slate-900 text-white text-[10px] font-mono px-2 py-1 rounded shadow-md z-30 whitespace-nowrap">
                      {stage.count.toLocaleString('pt-BR')} leads ({stage.percentage}%)
                    </div>
                  </div>
                ) : (
                  <div className="w-[3px] h-[18px] bg-slate-200 rounded-r-[2px]" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* X-axis Labels at the bottom */}
      <div className="flex w-full mt-2.5 border-t border-slate-100 pt-2">
        <div className="w-[125px] shrink-0" />
        <div className="flex-1 flex justify-between">
          {ticks.map((tick, idx) => (
            <span key={idx} className="text-[10px] font-bold font-mono text-slate-400 -translate-x-1/2 leading-none">
              {tick >= 1000 ? `${(tick / 1000).toFixed(tick % 1000 === 0 ? 0 : 1)}k` : tick}
            </span>
          ))}
        </div>
      </div>
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
