import { FormField } from '../../components/ui';
import {
  assessmentDueDateProblem,
  DEFAULT_ASSESSMENT_DAYS,
  earliestAssessmentDueDate,
  latestAssessmentDueDate,
} from '../../lib/assessmentApi';

/**
 * The day a candidate must answer a Candidate Assessment by. Starts at the
 * default of DEFAULT_ASSESSMENT_DAYS days; the employer can pick another day.
 * The answer window runs to the end of that day, Philippine time.
 */
export function AssessmentDeadlineField({ value, onChange, className, label = 'Response deadline' }: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  label?: string;
}) {
  const problem = value ? assessmentDueDateProblem(value) : '';
  return (
    <FormField
      label={label}
      help={problem || `Candidates get ${DEFAULT_ASSESSMENT_DAYS} days by default. They can answer until the end of this day (Philippine time), and you can extend it later.`}
      className={className}
    >
      <input
        className="k-input"
        type="date"
        value={value}
        min={earliestAssessmentDueDate()}
        max={latestAssessmentDueDate()}
        aria-invalid={problem ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    </FormField>
  );
}
