/**
 * Looks of the iPhone widget, mirrored from ios/LingoLensWidget (WidgetTheme). The ids are the Swift raw values: the chosen id is sent to
 * the widget with the words. The preview in Settings → Widget draws with these values, so keep both sides in step.
 * Text colours are chosen for strong contrast: near-black on light backgrounds, white on dark / coloured ones.
 */
export type WidgetThemeId = 'white' | 'dark' | 'blue' | 'green' | 'pink' | 'orange' | 'sunset' | 'ocean' | 'aurora' | 'glassLight' | 'glassDark';

export interface WidgetThemeDef {
  id: WidgetThemeId;
  label: string;
  /** CSS background (layers allowed) */
  bg: string;
  ink: string;
  accent: string;
  onDark: boolean;
  border?: string;
}

const lin = (...c: string[]) => `linear-gradient(135deg, ${c.join(', ')})`;

export const WIDGET_THEMES: WidgetThemeDef[] = [
  { id: 'white', label: 'Trắng', bg: '#ffffff', ink: '#111827', accent: '#2F46C8', onDark: false },
  { id: 'dark', label: 'Tối', bg: '#111827', ink: '#ffffff', accent: '#93C5FD', onDark: true },
  { id: 'blue', label: 'Xanh dương', bg: lin('#1E3A8A', '#2563EB'), ink: '#ffffff', accent: '#FDE68A', onDark: true },
  { id: 'green', label: 'Xanh lá', bg: lin('#064E3B', '#15803D'), ink: '#ffffff', accent: '#FDE68A', onDark: true },
  { id: 'pink', label: 'Hồng', bg: lin('#831843', '#BE185D'), ink: '#ffffff', accent: '#FDE68A', onDark: true },
  { id: 'orange', label: 'Cam', bg: lin('#7C2D12', '#B45309'), ink: '#ffffff', accent: '#A5F3FC', onDark: true },
  { id: 'sunset', label: 'Hoàng hôn', bg: lin('#4C1D95', '#BE185D', '#B45309'), ink: '#ffffff', accent: '#A5F3FC', onDark: true },
  { id: 'ocean', label: 'Đại dương', bg: 'linear-gradient(160deg, #0C4A6E, #0E7490, #115E59)', ink: '#ffffff', accent: '#FDE68A', onDark: true },
  {
    id: 'aurora',
    label: 'Màu loang',
    bg: 'linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.35)), radial-gradient(circle at 18% 18%, #7C3AED 0, transparent 48%), radial-gradient(circle at 85% 50%, #0891B2 0, transparent 48%), radial-gradient(circle at 40% 105%, #DB2777 0, transparent 48%), #0B1020',
    ink: '#ffffff',
    accent: '#FDE68A',
    onDark: true,
  },
  {
    id: 'glassLight',
    label: 'Kính mờ sáng',
    bg: 'linear-gradient(rgba(255,255,255,.4), rgba(255,255,255,.4)), radial-gradient(circle at 85% 15%, rgba(165,180,252,.6) 0, transparent 50%), linear-gradient(135deg, #DBEAFE, #FCE7F3)',
    ink: '#0F172A',
    accent: '#2F46C8',
    onDark: false,
    border: 'rgba(255,255,255,.9)',
  },
  {
    id: 'glassDark',
    label: 'Kính mờ tối',
    bg: 'linear-gradient(rgba(255,255,255,.08), rgba(255,255,255,.08)), radial-gradient(circle at 85% 15%, rgba(99,102,241,.5) 0, transparent 50%), linear-gradient(135deg, #1E1B4B, #0F172A)',
    ink: '#ffffff',
    accent: '#FDE68A',
    onDark: true,
    border: 'rgba(255,255,255,.35)',
  },
];

export const themeById = (id: string | null | undefined): WidgetThemeDef => WIDGET_THEMES.find((t) => t.id === id) ?? WIDGET_THEMES[0];
