export { FormField, PageHeader, SectionHead } from '../../components/ui';
import { applicationBadgeClass, type ApplicationStatus } from './model';

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return <span className={applicationBadgeClass(status)}>{status}</span>;
}
