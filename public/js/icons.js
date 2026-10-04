// 导航图标：统一 24×24 网格细线条风格（stroke 用 currentColor，随激活态变色）
export const ICONS = {
  home: `
    <path d="M3.5 11.2 12 4l8.5 7.2"/>
    <path d="M5.5 10v9.5h13V10"/>
    <path d="M10 19.5v-5h4v5"/>`,
  dashboard: `
    <rect x="3" y="3" width="7.5" height="10" rx="2"/>
    <rect x="13.5" y="3" width="7.5" height="6" rx="2"/>
    <rect x="13.5" y="12" width="7.5" height="9" rx="2"/>
    <rect x="3" y="16" width="7.5" height="5" rx="2"/>`,
  plan: `
    <rect x="3.5" y="5" width="17" height="16" rx="3"/>
    <path d="M8 3v4M16 3v4M3.5 10.5h17"/>`,
  materials: `
    <path d="M2.5 3h5.5a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3h-6.5z"/>
    <path d="M21.5 3H16a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h6.5z"/>`,
  videos: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M10.1 8.5v7l5.8-3.5z"/>`,
  capture: `
    <circle cx="12" cy="12" r="9"/>
    <path d="M3 12h18"/>
    <path d="M12 3c2.6 2.4 4.1 5.6 4.1 9s-1.5 6.6-4.1 9c-2.6-2.4-4.1-5.6-4.1-9s1.5-6.6 4.1-9z"/>`,
  frontier: `
    <path d="M10 3h4M10.5 3v5.8L4.8 18.4A2 2 0 0 0 6.6 21.3h10.8a2 2 0 0 0 1.8-2.9L13.5 8.8V3"/>
    <path d="M7.2 15h9.6"/>
    <circle cx="11" cy="18" r="0.4"/>
    <circle cx="14" cy="18.6" r="0.4"/>`,
  settings: `
    <path d="M4 6h8.4M17.6 6H20M4 12h2.4M10.6 12H20M4 18h10.4M18.6 18H20"/>
    <circle cx="15" cy="6" r="2.2"/>
    <circle cx="8" cy="12" r="2.2"/>
    <circle cx="16" cy="18" r="2.2"/>`,
};
