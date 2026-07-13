import puzzleLogo from '../assets/kareerlylogo_puzzle.png';
import wordmarkLogo from '../assets/kareerlylogo_name.png';

type LogoProps = {
  className?: string;
  wordmarkClassName?: string;
  layout?: 'row' | 'stack';
  size?: 'header' | 'auth' | 'module';
  onClick?: () => void;
};

const sizeConfig: Record<NonNullable<LogoProps['size']>, { container: number; puzzle: number; wordmark: number }> = {
  header: { container: 36, puzzle: 36, wordmark: 28 },
  auth: { container: 52, puzzle: 52, wordmark: 36 },
  module: { container: 40, puzzle: 40, wordmark: 30 },
};

export default function Logo({ className = '', wordmarkClassName = '', layout = 'row', size = 'header', onClick }: LogoProps) {
  const config = sizeConfig[size];
  const layoutClasses = layout === 'stack'
    ? 'flex flex-col items-center gap-2'
    : 'flex items-center gap-3';

  return (
    <a
      className={`logo ${layoutClasses} no-underline ${className}`}
      href="#"
      onClick={(event) => {
        if (onClick) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <div
        className="logo-puzzle flex items-center justify-center"
        style={{ width: config.container, height: config.container }}
      >
        <img
          src={puzzleLogo}
          alt="Kareerly puzzle logo"
          className="object-contain"
          style={{ width: config.puzzle, height: config.puzzle }}
        />
      </div>

      <div
        className={`logo-wordmark flex items-center justify-center ${wordmarkClassName}`}
      >
        <img
          src={wordmarkLogo}
          alt="Kareerly wordmark"
          className="object-contain"
          style={{ height: config.wordmark }}
        />
      </div>
    </a>
  );
}
