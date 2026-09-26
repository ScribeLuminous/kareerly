import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faBell,
  faBriefcase,
  faCheck,
  faClipboardList,
  faCompass,
  faHouse,
  faLanguage,
  faLayerGroup,
  faMagnifyingGlassChart,
  faPuzzlePiece,
  faRightFromBracket,
  faSliders,
  faUser,
} from '@fortawesome/free-solid-svg-icons';
import Logo from '../../components/Logo';
import { useDismiss } from '../../components/ui';
import type { CandidateNotification } from '../../lib/api';
import { tr, type DashboardPage, type UiLanguage } from './model';
import { navSectionFor, PAGE_PATHS, type NavSection } from './routes';

const NAV: Array<{ id: NavSection; page: DashboardPage; label: string; icon: IconDefinition }> = [
  { id: 'home', page: 'dashboard', label: 'Home', icon: faHouse },
  { id: 'matches', page: 'jobmatches', label: 'Matches', icon: faBriefcase },
  { id: 'skills', page: 'skillgaps', label: 'Skills', icon: faPuzzlePiece },
  { id: 'kareers', page: 'kareers', label: 'Kareers', icon: faCompass },
  { id: 'applications', page: 'applications', label: 'Applications', icon: faLayerGroup },
];

type ShellProps = {
  activePage: DashboardPage;
  onNavigate: (page: DashboardPage) => void;
  onHome: () => void;
  onLogout: () => void;
  displayName: string;
  displayEmail: string;
  initials: string;
  uiLanguage: UiLanguage;
  onLanguage: (language: UiLanguage) => void;
  notifications: CandidateNotification[];
  notificationStatus: 'loading' | 'ready' | 'error';
  unreadCount: number;
  onOpenNotifications: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (notification: CandidateNotification) => void;
  applicationsBadge: number;
  children: ReactNode;
};

export function CandidateShell({
  activePage,
  onNavigate,
  onHome,
  onLogout,
  displayName,
  displayEmail,
  initials,
  uiLanguage,
  onLanguage,
  notifications,
  notificationStatus,
  unreadCount,
  onOpenNotifications,
  onMarkAllRead,
  onMarkRead,
  applicationsBadge,
  children,
}: ShellProps) {
  const t = (text: string) => tr(uiLanguage, text);
  const current = navSectionFor(activePage);
  const go = (page: DashboardPage) => (event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(page);
  };

  return (
    <div className="k-shell cand-dashboard">
      <a className="k-btn k-btn-primary sr-only-focusable fixed left-2 top-2 z-[1001]" href="#main-content">Skip to content</a>
      <header className="k-topbar">
        <Logo size="module" onClick={onHome} />
        <div className="k-topbar-spacer" />
        <NotificationsMenu
          notifications={notifications}
          status={notificationStatus}
          unreadCount={unreadCount}
          onOpen={onOpenNotifications}
          onMarkAllRead={onMarkAllRead}
          onMarkRead={onMarkRead}
          onOpenMessages={() => onNavigate('messages')}
          onOpenApplications={() => onNavigate('applications')}
        />
        <AccountMenu
          displayName={displayName}
          displayEmail={displayEmail}
          initials={initials}
          uiLanguage={uiLanguage}
          onLanguage={onLanguage}
          onProfile={() => onNavigate('account')}
          onPreferences={() => onNavigate('preferences')}
          onLogout={onLogout}
          t={t}
        />
      </header>

      <nav className="k-nav" aria-label="Main">
        {NAV.map((item) => (
          <a
            key={item.id}
            className="k-nav-item"
            href={PAGE_PATHS[item.page]}
            aria-current={current === item.id ? 'page' : undefined}
            onClick={go(item.page)}
          >
            <span className="k-nav-icon">
              <FontAwesomeIcon icon={item.icon} aria-hidden="true" />
              {item.id === 'applications' && applicationsBadge > 0 && (
                <span className="k-dot-badge lg:hidden" aria-hidden="true">{applicationsBadge}</span>
              )}
            </span>
            <span className="k-nav-label">{t(item.label)}</span>
            {item.id === 'applications' && applicationsBadge > 0 && (
              <>
                <span className="k-dot-badge hidden lg:inline-block" aria-hidden="true">{applicationsBadge}</span>
                <span className="sr-only">, {applicationsBadge} message request{applicationsBadge === 1 ? '' : 's'}</span>
              </>
            )}
          </a>
        ))}
        <div className="k-nav-extra">
          <a
            className="k-btn k-btn-secondary k-btn-block"
            href={PAGE_PATHS['external-job']}
            aria-current={activePage === 'external-job' ? 'page' : undefined}
            onClick={go('external-job')}
          >
            <FontAwesomeIcon icon={faMagnifyingGlassChart} aria-hidden="true" />
            Analyze a job
          </a>
        </div>
      </nav>

      <main id="main-content" className="k-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

function AccountMenu({ displayName, displayEmail, initials, uiLanguage, onLanguage, onProfile, onPreferences, onLogout, t }: {
  displayName: string;
  displayEmail: string;
  initials: string;
  uiLanguage: UiLanguage;
  onLanguage: (language: UiLanguage) => void;
  onProfile: () => void;
  onPreferences: () => void;
  onLogout: () => void;
  t: (text: string) => string;
}) {
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
        aria-label={`Account menu for ${displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="k-avatar" aria-hidden="true">{initials}</span>
      </button>
      {open && (
        <div className="k-popover w-64" role="menu" aria-label="Account">
          <div className="border-b border-bdr px-3 pb-3 pt-2">
            <div className="k-item-title truncate">{displayName}</div>
            <div className="k-meta truncate">{displayEmail}</div>
          </div>
          <div className="pt-1">
            <button className="k-menu-item" type="button" role="menuitem" onClick={choose(onProfile)}>
              <FontAwesomeIcon icon={faUser} aria-hidden="true" />{t('Profile & resume')}
            </button>
            <button className="k-menu-item" type="button" role="menuitem" onClick={choose(onPreferences)}>
              <FontAwesomeIcon icon={faSliders} aria-hidden="true" />{t('Preferences')}
            </button>
          </div>
          <div className="mt-1 border-t border-bdr px-3 pb-2 pt-3">
            <div className="k-meta mb-2 flex items-center gap-2"><FontAwesomeIcon icon={faLanguage} aria-hidden="true" />{t('Language')}</div>
            <div className="k-seg" role="radiogroup" aria-label={t('Language')}>
              {(['en', 'fil'] as const).map((language) => (
                <button
                  key={language}
                  className="k-seg-btn"
                  type="button"
                  role="radio"
                  aria-checked={uiLanguage === language}
                  onClick={() => onLanguage(language)}
                >
                  {language === 'en' ? 'English' : 'Filipino'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1 border-t border-bdr pt-1">
            <button className="k-menu-item" type="button" role="menuitem" onClick={choose(onLogout)}>
              <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />{t('Logout')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationsMenu({ notifications, status, unreadCount, onOpen, onMarkAllRead, onMarkRead, onOpenMessages, onOpenApplications }: {
  notifications: CandidateNotification[];
  status: 'loading' | 'ready' | 'error';
  unreadCount: number;
  onOpen: () => void;
  onMarkAllRead: () => void;
  onMarkRead: (notification: CandidateNotification) => void;
  onOpenMessages: () => void;
  onOpenApplications: () => void;
}) {
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
          if (!open) onOpen();
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
            ) : notifications.length === 0 ? (
              <p className="k-secondary px-4 py-6 text-center">No notifications yet.</p>
            ) : (
              <ul className="divide-y divide-bdr">
                {notifications.map((row) => {
                  const unread = !row.read_at;
                  const isMessage = row.event_type === 'message_request';
                  return (
                    <li key={row.id} className={`flex items-start gap-2 py-2 pl-4 pr-1 ${unread ? 'bg-rust-l/60' : ''}`}>
                      <button
                        className="min-w-0 flex-1 py-1 text-left"
                        type="button"
                        onClick={() => {
                          if (unread) onMarkRead(row);
                          setOpen(false);
                          if (isMessage) onOpenMessages();
                          else onOpenApplications();
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <FontAwesomeIcon className="text-soft-text" icon={isMessage ? faClipboardList : faLayerGroup} aria-hidden="true" />
                          <span className="k-label">{row.title}</span>
                          {unread && <span className="sr-only">(unread)</span>}
                        </span>
                        <span className="k-secondary mt-0.5 block">{row.message}</span>
                        <span className="k-meta mt-1 block">{new Date(row.created_at).toLocaleString()}</span>
                      </button>
                      {unread && (
                        <button className="k-icon-btn" type="button" aria-label="Mark as read" onClick={() => onMarkRead(row)}>
                          <FontAwesomeIcon icon={faCheck} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
