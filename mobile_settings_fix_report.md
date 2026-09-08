# Task Report: Fix Settings Button on Mobile

## Summary
Successfully fixed the issue where the Settings button was not visible on mobile devices.

## Problem
The Activity Bar (containing Settings, Files, and Agents buttons) was conditionally hidden on mobile devices using the condition `{!isMobile && (...)}`. This meant mobile users had no way to access the Settings view.

## Root Cause
In `web/src/App.tsx`, line 1576:
```tsx
{/* Activity Bar (ẩn trên mobile) */}
{!isMobile && (
  <div className="af-activitybar" ...>
```

The entire Activity Bar was hidden when `isMobile === true` (viewport < 768px).

## Solution
Added a Settings button (⚙️) directly in the sidebar header area that is always visible, regardless of screen size.

### File Modified
- `web/src/App.tsx` (lines 1641-1663)

### Code Change
```tsx
{/* Settings icon: always visible on mobile to access Settings view (activity bar hidden on mobile) */}
<button
  onClick={() => setActiveView('settings')}
  title="Cài đặt / Settings"
  aria-label="Settings"
  aria-current={activeView === 'settings' ? 'page' : undefined}
  style={{
    width: 30,
    height: 30,
    borderRadius: 8,
    border: activeView === 'settings' ? '1px solid var(--accent)' : '1px solid rgba(15,23,42,0.12)',
    background: activeView === 'settings' ? 'var(--accent-soft)' : (theme === 'dark' ? 'var(--bg-input)' : '#ffffff'),
    color: activeView === 'settings' ? 'var(--accent)' : (theme === 'dark' ? '#94a3b8' : '#64748b'),
    fontSize: 15,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  }}
>
  ⚙️
</button>
```

## Build Status
✅ Build completed successfully:
- Web app built using: `npx vite build --config web/vite.config.ts`
- Output: `dist/` folder
- No compilation errors

## Verification Checklist for Verifier
- [ ] Settings button visible on mobile viewport (<768px width)
- [ ] Clicking Settings button switches to Settings view
- [ ] Settings panel contains expected options (Watchdog, Auto Continue, Expand Toolcalls, Model Hierarchy, Team Settings)
- [ ] Build artifacts correctly generated in dist/ folder
- [ ] No regressions on desktop view
