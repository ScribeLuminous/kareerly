import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faArrowUpRightFromSquare, faBars, faBell, faBook, faBookmark, faBriefcase, faBuilding, faBullseye, faChartLine, faChevronDown, faCircleCheck, faFlag, faBan, faClipboard, faClock, faColumns, faComments, faCompass, faEye, faFilter, faGraduationCap, faLaptop, faLayerGroup, faLightbulb, faList, faLocationDot, faMagnifyingGlass, faPaperPlane, faPuzzlePiece, faRightFromBracket, faRocket, faShieldHalved, faSliders, faTableCellsLarge, faTrash, faUpload, faUser, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

export type IconName =
  | 'menu'
  | 'bell'
  | 'chevron-down'
  | 'dashboard'
  | 'briefcase'
  | 'lightbulb'
  | 'clipboard'
  | 'sliders'
  | 'user'
  | 'compass'
  | 'book'
  | 'message'
  | 'chart'
  | 'target'
  | 'search'
  | 'clock'
  | 'list'
  | 'upload'
  | 'trash'
  | 'logout'
  | 'puzzle'
  | 'layers'
  | 'graduation'
  | 'building'
  | 'location'
  | 'setup'
  | 'eye'
  | 'external'
  | 'bookmark'
  | 'paper-plane'
  | 'shield'
  | 'columns'
  | 'filter'
  | 'check-circle'
  | 'rocket'
  | 'close'
  | 'flag'
  | 'ban';

const iconMap: Record<IconName, IconDefinition> = {
  menu: faBars,
  bell: faBell,
  'chevron-down': faChevronDown,
  dashboard: faTableCellsLarge,
  briefcase: faBriefcase,
  lightbulb: faLightbulb,
  clipboard: faClipboard,
  sliders: faSliders,
  user: faUser,
  compass: faCompass,
  book: faBook,
  message: faComments,
  chart: faChartLine,
  target: faBullseye,
  search: faMagnifyingGlass,
  clock: faClock,
  list: faList,
  upload: faUpload,
  trash: faTrash,
  logout: faRightFromBracket,
  puzzle: faPuzzlePiece,
  layers: faLayerGroup,
  graduation: faGraduationCap,
  building: faBuilding,
  location: faLocationDot,
  setup: faLaptop,
  eye: faEye,
  external: faArrowUpRightFromSquare,
  bookmark: faBookmark,
  'paper-plane': faPaperPlane,
  shield: faShieldHalved,
  columns: faColumns,
  filter: faFilter,
  'check-circle': faCircleCheck,
  rocket: faRocket,
  close: faXmark,
  flag: faFlag,
  ban: faBan,
};

export function UIIcon({ name, className = '' }: { name: IconName; className?: string }) {
  const baseClass = `cand-inline-icon ${className}`.trim();
  return <FontAwesomeIcon className={baseClass} icon={iconMap[name] || faBars} aria-hidden="true" />;
}
