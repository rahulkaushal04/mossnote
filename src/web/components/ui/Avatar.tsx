import { cx } from '../../lib/cx';

/** The first letter or digit of a name, upper case. A dot when there is none. */
export function initialOf(name: string): string {
  const match = /[\p{L}\p{N}]/u.exec(name);
  return match ? match[0].toUpperCase() : '·';
}

/** A stable tint (0 or 1) for a name, so the same person always looks the same. */
export function avatarTint(name: string): 0 | 1 {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 997;
  return hash % 2 === 0 ? 0 : 1;
}

/** A monogram in a tinted circle. Decorative: the name next to it is the label. */
export function Avatar({
  name,
  small = false,
  className,
}: {
  name: string;
  small?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-tint={avatarTint(name)}
      className={cx('avatar', small && 'avatar-sm', className)}
    >
      {initialOf(name)}
    </span>
  );
}
