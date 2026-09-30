// Inline icons (stroke = currentColor).
type P = { size?: number };
const S = ({ size = 18, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const IconLogo = (p: P) => <S {...p}><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" /><path d="M4 20h16" /></S>;
export const IconPlus = (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IconSend = (p: P) => <S {...p}><path d="M12 19V5M5 12l7-7 7 7" /></S>;
export const IconStop = (p: P) => <S {...p}><rect x="7" y="7" width="10" height="10" rx="1.5" /></S>;
export const IconMenu = (p: P) => <S {...p}><path d="M4 7h16M4 12h16M4 17h16" /></S>;
export const IconClose = (p: P) => <S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IconTrash = (p: P) => <S {...p}><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></S>;
export const IconPin = (p: P) => <S {...p}><path d="M12 21s-6-5.5-6-11a6 6 0 1 1 12 0c0 5.5-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></S>;
export const IconBook = (p: P) => <S {...p}><path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z" /><path d="M5 16a4 4 0 0 1 4-4h10" /></S>;
export const IconCheck = (p: P) => <S {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></S>;
export const IconAlert = (p: P) => <S {...p}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.5v.01" /></S>;
export const IconExternal = (p: P) => <S {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></S>;
export const IconSun = (p: P) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>;
export const IconMoon = (p: P) => <S {...p}><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></S>;
export const IconInfo = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></S>;
export const IconPanel = (p: P) => <S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></S>;
export const IconBack = (p: P) => <S {...p}><path d="M15 6l-6 6 6 6" /></S>;
export const IconSliders = (p: P) => <S {...p}><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></S>;
