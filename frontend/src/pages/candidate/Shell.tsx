import type { ReactNode } from 'react';
import {
  faBriefcase,
  faClipboardList,
  faCompass,
  faHouse,
  faLayerGroup,
  faPuzzlePiece,
  faSliders,
  faUser,
} from '@fortawesome/free-solid-svg-icons';
import { AppShell, type ShellNavItem } from '../../components/ui';
import type { CandidateNotification } from '../../lib/api';
import { tr, type DashboardPage, type UiLanguage } from './model';
import { navSectionFor, PAGE_PATHS } from './routes';

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
  const item = (id: NonNullable<typeof current>, page: DashboardPage, label: string, icon: ShellNavItem['icon']): ShellNavItem => ({
    id,
    href: PAGE_PATHS[page],
    label: t(label),
    icon,
    current: current === id,
    onSelect: () => onNavigate(page),
  });
  const messageRequests = (count: number) => `${count} message request${count === 1 ? '' : 's'}`;
  const nav: ShellNavItem[] = [
    item('home', 'dashboard', 'Home', faHouse),
    item('matches', 'jobmatches', 'Matches', faBriefcase),
    item('skills', 'skillgaps', 'Skills', faPuzzlePiece),
    {
      // Applications and Analyze a job live under Kareers, so its message requests count shows here.
      ...item('kareers', 'kareers', 'Kareers', faCompass),
      badge: applicationsBadge,
      badgeLabel: messageRequests,
      menu: [
        { id: 'kareers', href: PAGE_PATHS.kareers, label: t('All jobs'), current: activePage === 'kareers', onSelect: () => onNavigate('kareers') },
        {
          id: 'applications',
          href: PAGE_PATHS.applications,
          label: t('Applications'),
          current: activePage === 'applications' || activePage === 'messages',
          onSelect: () => onNavigate('applications'),
          badge: applicationsBadge,
          badgeLabel: messageRequests,
        },
        { id: 'external-job', href: PAGE_PATHS['external-job'], label: t('Analyze a job'), current: activePage === 'external-job', onSelect: () => onNavigate('external-job') },
      ],
    },
  ];

  return (
    <AppShell
      onHome={onHome}
      nav={nav}
      layout="centered"
      notifications={{
        items: notifications.map((row) => {
          const isMessage = row.event_type === 'message_request';
          return {
            id: row.id,
            title: row.title,
            message: row.message,
            time: new Date(row.created_at).toLocaleString(),
            unread: !row.read_at,
            icon: isMessage ? faClipboardList : faLayerGroup,
            onOpen: () => onNavigate(isMessage ? 'messages' : 'applications'),
            onMarkRead: () => onMarkRead(row),
          };
        }),
        status: notificationStatus,
        unreadCount,
        onOpen: onOpenNotifications,
        onMarkAllRead,
      }}
      account={{
        name: displayName,
        email: displayEmail,
        initials,
        items: [
          { label: t('Profile & resume'), icon: faUser, onSelect: () => onNavigate('account') },
          { label: t('Preferences'), icon: faSliders, onSelect: () => onNavigate('preferences') },
        ],
        logoutLabel: t('Logout'),
        onLogout,
        language: { value: uiLanguage, label: t('Language'), onChange: onLanguage },
      }}
    >
      {children}
    </AppShell>
  );
}
