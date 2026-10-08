import { Dialog, type DialogProps } from './Dialog';

/**
 * A bottom sheet at every width: for the More tab, filter lists and the map inspector, which
 * are opened from phone-style controls. Same behaviour as a Dialog (focus trap, Esc, focus return).
 */
export function Sheet(props: Omit<DialogProps, 'placement' | 'className'>) {
  return <Dialog {...props} placement="sheet" />;
}
