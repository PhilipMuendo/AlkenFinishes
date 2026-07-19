/**
 * Validated categorical palette (light mode, adjacent-pair CVD ΔE ≥ 8,
 * normal-vision ΔE ≥ 15). Fixed assignment: color follows the entity.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  MATERIALS: '#2a78d6', // blue
  LABOUR: '#008300', // green
  TRANSPORT: '#e87ba4', // magenta
  OTHER: '#eda100', // yellow
};

export const SERIES = {
  primary: '#2a78d6',
  secondary: '#008300',
};

export const CHART_TEXT = '#52514e';
export const GRID = '#e7e5e0';

export const tooltipStyle = {
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  fontSize: 12,
  boxShadow: '0 4px 12px rgb(0 0 0 / 0.08)',
};
