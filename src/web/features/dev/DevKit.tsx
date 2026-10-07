import { useState } from 'react';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/ui/Toast';

/** Literal class names so Tailwind can see them. */
const TOKENS: [name: string, swatch: string][] = [
  ['paper', 'bg-paper'],
  ['surface', 'bg-surface'],
  ['raised', 'bg-raised'],
  ['ink', 'bg-ink'],
  ['ink-muted', 'bg-ink-muted'],
  ['rule', 'bg-rule'],
  ['accent', 'bg-accent'],
  ['accent-ink', 'bg-accent-ink'],
  ['discovery', 'bg-discovery'],
  ['question', 'bg-question'],
  ['danger', 'bg-danger'],
];

/**
 * Hidden `/dev/kit` route for visual review of the primitives (spec section 13). It is compiled
 * into development and `--mode e2e` builds only, never into `npm run build`.
 */
export default function DevKit() {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      <PageHeader title="Kit" />
      <section className="flex flex-col gap-6 py-6">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="btn tap"
            onClick={() => {
              setOpen(true);
            }}
          >
            Open dialog
          </button>
          <button
            type="button"
            className="btn tap"
            onClick={() => {
              toast.show({
                message: 'Item deleted',
                actionLabel: 'Undo',
                onAction: () => undefined,
              });
            }}
          >
            Show toast with Undo
          </button>
          <button type="button" className="btn btn-primary tap">
            Primary
          </button>
        </div>
        <EmptyState>An empty state is one quiet line.</EmptyState>
        <ul className="grid grid-cols-2 gap-2">
          {TOKENS.map(([token, swatch]) => (
            <li
              key={token}
              className="flex items-center gap-2 rounded-control border border-rule p-2"
            >
              <span
                aria-hidden="true"
                className={`size-6 rounded-control border border-rule ${swatch}`}
              />
              {token}
            </li>
          ))}
        </ul>
        <p className="reading">
          Reading text uses the serif face. <em>Italic</em> and <strong>bold</strong>.
        </p>
      </section>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Example dialog"
        description="A labelled, focus-trapped dialog."
      >
        <p>Dialog content.</p>
      </Dialog>
    </>
  );
}
