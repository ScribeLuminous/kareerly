import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faBell, faCheck, faChevronDown, faLanguage, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import Logo from '../Logo';
import { useDismiss } from './hooks';

export type ShellNavItem = {
  id: string;
  href: string;
  label: string;
  icon: IconDefinition;
  current: boolean;
  onSelect: () => void;
  /** Count shown on the item (e.g. new message requests) and its spoken meaning. */
  badge?: number;
  badgeLabel?: (count: number) => string;
  /** Sub-pages shown as a dropdown under this item in the centred desktop tabs. */
  menu?: ShellSubItem[];
};

export type ShellSubItem = { id: string; href: string; label: string; current: boolean; onSelect: () => void; badge?: number; badgeLabel?: (count: number) => string };

export type ShellNotification = {
  id: string;
  title: string;
  message: string;
  time: string;
  unread: boolean;
  icon: IconDefinition;
  onOpen?: () => void;
  onMarkRead?: () => void;
};

export type ShellMenuItem = { label: string; icon: IconDefinition; onSelect: () => void };

type AppShellProps = {
  onHome: () => void;
  /** Short workspace label beside the logo, e.g. "Employer". */
  workspaceLabel?: string;
  nav: ShellNavItem[];
  /**
   * sidebar: bottom bar on phones, rail on tablets, labelled sidebar on desktop.
   * topnav: bottom bar on phones, labelled tabs in the top bar from tablets up.
   * centered: bottom bar on phones and tablets, text-only tabs centred in the
   * top bar on desktop.
   */
  layout?: 'sidebar' | 'topnav' | 'centered';
  /** One secondary action at the foot of the desktop sidebar. */
  sidebarAction?: { label: string; icon: IconDefinition; href: string; current: boolean; onSelect: () => void };
  notifications: {
    items: ShellNotification[];
    status: 'loading' | 'ready' | 'error';
    unreadCount: number;
    onOpen?: () => void;
    onMarkAllRead: () => void;
  };
  account: {
    name: string;
    email: string;
    initials: string;
    items: ShellMenuItem[];
    logoutLabel?: string;
    onLogout: () => void;
    language?: { value: 'en' | 'fil'; label: string; onChange: (value: 'en' | 'fil') => void };
  };
  children: ReactNode;
};

const plainClick = (onSelect: () => void) => (event: React.MouseEvent) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
  event.preventDefault();
  onSelect();
};

/**
 * The workspace frame shared by candidates and employers: bottom navigation
 * on phones, then (by layout) an icon rail and labelled sidebar, tabs in the
 * top bar, or centred text tabs on desktop; notifications and the account
 * menu sit in the top bar.
 */
export default function AppShell({ onHome, workspaceLabel, nav, layout = 'sidebar', sidebarAction, notifications, account, children }: AppShellProps) {
  return (
    <div className={`k-shell cand-dashboard ${layout === 'topnav' ? 'k-shell-topnav' : layout === 'centered' ? 'k-shell-centered' : ''}`}>
      <a className="k-btn k-btn-primary sr-only-focusable fixed left-2 top-2 z-[1001]" href="#main-content">Skip to content</a>
      {layout === 'centered' ? (
        <header className="k-topbar k-topbar-centered">
          <div className="k-topbar-start">
            <Logo size="module" onClick={onHome} />
            {workspaceLabel && <span className="k-badge k-badge-info ml-2 hidden sm:inline-flex">{workspaceLabel}</span>}
          </div>
          <nav className="k-centernav" aria-label="Main">
            {nav.map((item) => {
              if (item.menu) return <CenterNavMenu key={item.id} item={item} />;
              const badge = item.badge || 0;
              return (
                <a key={item.id} className="k-centernav-item" href={item.href} aria-current={item.current ? 'page' : undefined} onClick={plainClick(item.onSelect)}>
                  {item.label}
                  {badge > 0 && (
                    <>
                      <span className="k-centernav-count" aria-hidden="true">{badge}</span>
                      <span className="sr-only">, {item.badgeLabel ? item.badgeLabel(badge) : `${badge} new`}</span>
                    </>
                  )}
                </a>
              );
            })}
          </nav>
          <div className="k-topbar-end">
            <NotificationsMenu {...notifications} />
            <AccountMenu {...account} />
          </div>
        </header>
      ) : (
        <header className="k-topbar">
          <div className="k-topbar-zone">
            <Logo size="module" onClick={onHome} />
            {workspaceLabel && <span className="k-badge k-badge-info ml-2 hidden sm:inline-flex">{workspaceLabel}</span>}
          </div>
          {layout === 'topnav' && (
            <nav className="k-topnav" aria-label="Main">
              {nav.map((item) => {
                const badge = item.badge || 0;
                return (
                  <a key={item.id} className="k-topnav-item" href={item.href} aria-current={item.current ? 'page' : undefined} onClick={plainClick(item.onSelect)}>
                    <FontAwesomeIcon className="k-topnav-icon" icon={item.icon} aria-hidden="true" />
                    <span>{item.label}</span>
                    {badge > 0 && (
                      <>
                        <span className="k-topnav-count" aria-hidden="true">{badge}</span>
                        <span className="sr-only">, {item.badgeLabel ? item.badgeLabel(badge) : `${badge} new`}</span>
                      </>
                    )}
                  </a>
                );
              })}
            </nav>
          )}
          <div className="k-topbar-spacer" />
          <div className="k-topbar-zone k-topbar-zone-end">
            <NotificationsMenu {...notifications} />
            <AccountMenu {...account} />
          </div>
        </header>
      )}

      <nav className="k-nav" aria-label={layout === 'sidebar' ? 'Main' : 'Main, mobile'} style={{ gridTemplateColumns: nav.length === 4 ? 'repeat(4, minmax(0, 1fr))' : undefined }}>
        {nav.map((item) => {
          const badge = item.badge || 0;
          return (
            <a key={item.id} className="k-nav-item" href={item.href} aria-current={item.current ? 'page' : undefined} onClick={plainClick(item.onSelect)}>
              <span className="k-nav-icon">
                <FontAwesomeIcon icon={item.icon} aria-hidden="true" />
                {badge > 0 && <span className="k-dot-badge lg:hidden" aria-hidden="true">{badge}</span>}
              </span>
              <span className="k-nav-label">{item.label}</span>
              {badge > 0 && (
                <>
                  <span className="k-dot-badge hidden lg:inline-block" aria-hidden="true">{badge}</span>
                  <span className="sr-only">, {item.badgeLabel ? item.badgeLabel(badge) : `${badge} new`}</span>
                </>
              )}
            </a>
          );
        })}
        {sidebarAction && (
          <div className="k-nav-extra">
            <a
              className="k-btn k-btn-secondary k-btn-block"
              href={sidebarAction.href}
              aria-current={sidebarAction.current ? 'page' : undefined}
              onClick={plainClick(sidebarAction.onSelect)}
            >
              <FontAwesomeIcon icon={sidebarAction.icon} aria-hidden="true" />
              {sidebarAction.label}
            </a>
          </div>
        )}
      </nav>

      <main id="main-content" className="k-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function CountBadge({ count, label, className }: { count: number; label?: (count: number) => string; className: string }) {
  if (count <= 0) return null;
  return (
    <>
      <span className={className} aria-hidden="true">{count}</span>
      <span className="sr-only">, {label ? label(count) : `${count} new`}</span>
    </>
  );
}

/** A centred desktop tab that opens a short list of its sub-pages. */
function CenterNavMenu({ item }: { item: ShellNavItem }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const choose = (onSelect: () => void) => (event: React.MouseEvent) => {
    setOpen(false);
    plainClick(onSelect)(event);
  };
  return (
    <div ref={ref} className="k-popover-anchor k-centernav-group">
      <button
        className="k-centernav-item"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-current={item.current ? 'page' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {item.label}
        <CountBadge count={item.badge || 0} label={item.badgeLabel} className="k-centernav-count" />
        <FontAwesomeIcon className="k-centernav-caret" icon={faChevronDown} aria-hidden="true" />
      </button>
      {open && (
        <ul className="k-popover k-centernav-menu">
          {item.menu!.map((sub) => (
            <li key={sub.id}>
              <a className="k-menu-item" href={sub.href} aria-current={sub.current ? 'page' : undefined} onClick={choose(sub.onSelect)}>
                <span className="flex-1">{sub.label}</span>
                <CountBadge count={sub.badge || 0} label={sub.badgeLabel} className="k-centernav-count" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountMenu({ name, email, initials, items, logoutLabel = 'Log out', onLogout, language }: AppShellProps['account']) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div ref={ref} className="k-popover-anchor">
      <button
        className="k-icon-btn"
        type="button"
        aria-label={`Account menu for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="k-avatar" aria-hidden="true">{initials}</span>
      </button>
      {open && (
        <div className="k-popover w-64" role="menu" aria-label="Account">
          <div className="border-b border-bdr px-3 pb-3 pt-2">
            <div className="k-item-title truncate">{name}</div>
            <div className="k-meta truncate">{email}</div>
          </div>
          <div className="pt-1">
            {items.map((item) => (
              <button key={item.label} className="k-menu-item" type="button" role="menuitem" onClick={choose(item.onSelect)}>
                <FontAwesomeIcon icon={item.icon} aria-hidden="true" />{item.label}
              </button>
            ))}
          </div>
          {language && (
            <div className="mt-1 border-t border-bdr px-3 pb-2 pt-3">
              <div className="k-meta mb-2 flex items-center gap-2"><FontAwesomeIcon icon={faLanguage} aria-hidden="true" />{language.label}</div>
              <div className="k-seg" role="radiogroup" aria-label={language.label}>
                {(['en', 'fil'] as const).map((value) => (
                  <button key={value} className="k-seg-btn" type="button" role="radio" aria-checked={language.value === value} onClick={() => language.onChange(value)}>
                    {value === 'en' ? 'English' : 'Filipino'}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-1 border-t border-bdr pt-1">
            <button className="k-menu-item" type="button" role="menuitem" onClick={choose(onLogout)}>
              <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />{logoutLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsMenu({ items, status, unreadCount, onOpen, onMarkAllRead }: AppShellProps['notifications']) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div ref={ref} className="k-popover-anchor">
      <button
        className="k-icon-btn"
        type="button"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((value) => !value);
        }}
      >
        <FontAwesomeIcon icon={faBell} aria-hidden="true" />
        {unreadCount > 0 && <span className="k-dot-badge" aria-hidden="true">{unreadCount}</span>}
      </button>
      {open && (
        <div className="k-popover w-[min(360px,calc(100vw-24px))] p-0" role="region" aria-label="Notifications">
          <div className="flex items-center justify-between border-b border-bdr py-1 pl-4 pr-1">
            <h2 className="k-label">Notifications</h2>
            <button className="k-btn k-btn-ghost k-btn-sm" type="button" onClick={onMarkAllRead} disabled={unreadCount === 0}>
              Mark all read
            </button>
          </div>
          <div className="max-h-[60dvh] overflow-y-auto">
            {status === 'loading' ? (
              <p className="k-secondary px-4 py-6 text-center">Loading…</p>
            ) : status === 'error' ? (
              <p className="k-secondary px-4 py-6 text-center">Notifications couldn't load. Try again shortly.</p>
            ) : items.length === 0 ? (
              <p className="k-secondary px-4 py-6 text-center">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-bdr">
                {items.map((item) => (
                  <li key={item.id} className={`flex items-start gap-2 py-2 pl-4 pr-1 ${item.unread ? 'bg-rust-l/60' : ''}`}>
                    <button
                      className="min-w-0 flex-1 py-1 text-left"
                      type="button"
                      onClick={() => {
                        if (item.unread) item.onMarkRead?.();
                        setOpen(false);
                        item.onOpen?.();
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <FontAwesomeIcon className="text-soft-text" icon={item.icon} aria-hidden="true" />
                        <span className="k-label">{item.title}</span>
                        {item.unread && <span className="sr-only">(unread)</span>}
                      </span>
                      <span className="k-secondary mt-0.5 block">{item.message}</span>
                      <span className="k-meta mt-1 block">{item.time}</span>
                    </button>
                    {item.unread && item.onMarkRead && (
                      <button className="k-icon-btn" type="button" aria-label="Mark as read" onClick={item.onMarkRead}>
                        <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
