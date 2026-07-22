import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost';
  children: ReactNode;
}

/**
 * Placeholder for the shared design system (Phase 0). The real system —
 * Radix primitives + Tailwind tokens — lands as the UI matures.
 */
export function Button({ variant = 'primary', children, ...rest }: ButtonProps): ReactElement {
  return (
    <button data-variant={variant} {...rest}>
      {children}
    </button>
  );
}
