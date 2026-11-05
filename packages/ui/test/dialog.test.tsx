// @vitest-environment jsdom
import { act, useState } from 'react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmDialog } from '../src/dialog/ConfirmDialog';
import { byText, click, mount, press, type Mounted } from './helpers/dom';

let m: Mounted | undefined;
afterEach(async () => {
  await m?.unmount();
  m = undefined;
});

/** An opener button that shows the dialog, recording what happened. */
function Harness(p: { log: string[]; slow?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" id="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <ConfirmDialog
          title={'Delete "Groceries" permanently?'}
          description={'Permanently delete "Groceries"? This cannot be undone.'}
          confirmLabel="Delete permanently"
          onCancel={() => {
            p.log.push('cancel');
            setOpen(false);
          }}
          onConfirm={async () => {
            p.log.push('confirm');
            if (p.slow) await new Promise((r) => setTimeout(r, 30));
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
const openIt = async (log: string[], slow = false) => {
  m = await mount(<Harness log={log} slow={slow} />);
  const opener = m.el.querySelector<HTMLElement>('#opener')!;
  await act(async () => opener.focus());
  await click(opener);
  return opener;
};

describe('ConfirmDialog', () => {
  it('is a modal alertdialog labelled by its title and described by the exact question', async () => {
    await openIt([]);
    const d = document.querySelector('[role=alertdialog]')!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(d.getAttribute('aria-labelledby')!)!;
    const desc = document.getElementById(d.getAttribute('aria-describedby')!)!;
    expect(title.textContent).toContain('"Groceries"');
    expect(desc.textContent).toBe('Permanently delete "Groceries"? This cannot be undone.');
  });

  it('puts initial focus on Cancel, not on the destructive button', async () => {
    await openIt([]);
    expect(document.activeElement).toBe(byText(document.body, 'Cancel'));
  });

  it('Cancel and Esc do nothing but close, and focus returns to the opener', async () => {
    const log: string[] = [];
    const opener = await openIt(log);
    await click(byText(document.body, 'Cancel'));
    expect(log).toEqual(['cancel']);
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);

    await click(opener);
    await press(document.activeElement!, 'Escape');
    expect(log).toEqual(['cancel', 'cancel']);
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('Esc does not reach handlers outside the dialog', async () => {
    await openIt([]);
    const seen: string[] = [];
    const h = (e: KeyboardEvent) => seen.push(e.key);
    document.addEventListener('keydown', h);
    await press(document.activeElement!, 'Escape');
    document.removeEventListener('keydown', h);
    expect(seen).toEqual([]);
  });

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    await openIt([]);
    const cancel = byText(document.body, 'Cancel')!;
    const del = byText(document.body, 'Delete permanently')!;
    await press(cancel, 'Tab');
    expect(document.activeElement).toBe(del);
    await press(del, 'Tab');
    expect(document.activeElement).toBe(cancel);
    await press(cancel, 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(del);
  });

  it('confirm runs onConfirm once even on a double click while it is pending', async () => {
    const log: string[] = [];
    await openIt(log, true);
    const del = byText(document.body, 'Delete permanently')!;
    await click(del);
    await click(del);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(log).toEqual(['confirm']);
    expect(document.querySelector('[role=alertdialog]')).toBeNull();
  });

  it('has no serious or critical axe violations', async () => {
    await openIt([]);
    const r = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });
});
