import { faFlag } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

export default function Hero() {
  return (
    <section className="text-center pt-16 pb-10 px-6 max-w-xl mx-auto">
      <div className="inline-flex items-center gap-1.5 bg-forest-l text-forest text-xs font-bold py-1 px-3.5 rounded-full mb-5">
        <FontAwesomeIcon icon={faFlag} aria-hidden="true" />
        <span>Made for Filipino job seekers</span>
      </div>

      <h1 className="font-display text-[42px] sm:text-[42px] font-extrabold leading-tight mb-4">
        Find the job<br />
        that <em className="text-rust not-italic">fits you</em>
      </h1>

      <p className="text-lg text-mid font-normal leading-relaxed">
        Upload your resume. We'll show you which jobs match your skills, what's holding you back, and how to get there.
      </p>
    </section>
  );
}
