import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const DOT_SIZE_MAP = {
  sm: 4,
  md: 5,
  lg: 6,
} as const;

type LoadingDotsSize = keyof typeof DOT_SIZE_MAP | number;

export type LoadingDotsProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  size?: LoadingDotsSize;
  label?: string;
};

function resolveDotDiameter(size: LoadingDotsSize) {
  return typeof size === 'number' ? size : DOT_SIZE_MAP[size];
}

export const LoadingDots = ({ className, size = 'sm', label, ...props }: LoadingDotsProps) => {
  const dotDiameter = resolveDotDiameter(size);
  const radius = Number((dotDiameter / 2).toFixed(2));
  const gap = Number((dotDiameter * 1.55).toFixed(2));
  const centerY = Number((dotDiameter * 1.1).toFixed(2));
  const svgHeight = Number((dotDiameter * 2.25).toFixed(2));
  const xPositions = [
    radius,
    Number((radius + gap).toFixed(2)),
    Number((radius + gap * 2).toFixed(2)),
  ];
  const svgWidth = Number((xPositions[2] + radius).toFixed(2));

  return (
    <span
      aria-hidden={label ? undefined : 'true'}
      aria-live={label ? 'polite' : undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center align-middle text-current',
        className
      )}
      role={label ? 'status' : undefined}
      {...props}
    >
      <svg
        aria-hidden="true"
        className="overflow-visible"
        fill="none"
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width={svgWidth}
      >
        {xPositions.map((x, index) => {
          const delay = `${index * 0.16}s`;
          const floatY = Number((centerY - radius * 0.55).toFixed(2));
          const expandedRadius = Number((radius * 1.04).toFixed(2));
          const compactRadius = Number((radius * 0.9).toFixed(2));

          return (
            <g key={x}>
              <circle cx={x} cy={centerY} fill="currentColor" opacity="0.32" r={radius}>
                <animate
                  attributeName="cy"
                  begin={delay}
                  dur="1.15s"
                  repeatCount="indefinite"
                  values={`${centerY};${floatY};${centerY}`}
                />
                <animate
                  attributeName="opacity"
                  begin={delay}
                  dur="1.15s"
                  repeatCount="indefinite"
                  values="0.28;0.95;0.28"
                />
                <animate
                  attributeName="r"
                  begin={delay}
                  dur="1.15s"
                  repeatCount="indefinite"
                  values={`${compactRadius};${expandedRadius};${compactRadius}`}
                />
              </circle>
            </g>
          );
        })}
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
};
