import { useId } from 'react';

/** Original Origrami folded-letter symbol. Unique gradient IDs support multiple instances. */
export default function BrandMark({ size = 48, className = '' }) {
  const id = useId().replaceAll(':', '');
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" fill="none" role="img" aria-label="Origrami: folded letter">
      <defs>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--logo-top-light, #f5d788)" />
          <stop offset="0.56" stopColor="var(--logo-top-mid, #d4a64c)" />
          <stop offset="1" stopColor="var(--logo-top-dark, #8f6828)" />
        </linearGradient>
        <linearGradient id={`${id}-left`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--logo-side-light, #dfb660)" />
          <stop offset="1" stopColor="var(--logo-side-dark, #755322)" />
        </linearGradient>
        <linearGradient id={`${id}-right`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--logo-right-light, #f8d77d)" />
          <stop offset="1" stopColor="var(--logo-right-dark, #8e6225)" />
        </linearGradient>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--logo-front-light, #eed086)" />
          <stop offset="1" stopColor="var(--logo-front-dark, #b88736)" />
        </linearGradient>
      </defs>
      <path d="M10 31 50 13 90 31 50 66 10 31Z" fill={`url(#${id}-top)`} />
      <path d="M10 31v43l40 17V66L10 31Z" fill={`url(#${id}-left)`} />
      <path d="M90 31v43L50 91V66l40-35Z" fill={`url(#${id}-right)`} />
      <path d="m10 74 40-33 40 33-40 17-40-17Z" fill={`url(#${id}-front)`} />
      <path d="m10 31 40 35 40-35M50 41v25" stroke="var(--logo-fold, #fff0c6)" strokeWidth="2.25" strokeLinejoin="round" />
      <path d="m10 74 40 17 40-17" stroke="var(--logo-ridge, #6a4b27)" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
