import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { isTypingTarget } from '../../lib/hotkeys';

export interface ToastOptions {
  message: string;
  /** Label for the single action, for example "Undo". */
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds before it disappears. Default 8000. */
  duration?: number;
  /** `alert` for blocking errors, `status` (default) for everything else. */
  tone?: 'status' | 'alert';
}

interface ToastItem extends ToastOptions {
  id: number;
}

interface ToastApi {
  show(options: ToastOptions): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>.');
  return value;
}

const DEFAULT_DURATION = 8000;

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const duration = toast.duration ?? DEFAULT_DURATION;

  // Pause on hover and focus; resume with the full duration so nothing depends on timing.
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDismiss, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [paused, duration, onDismiss]);

  const pause = () => {
    setPaused(true);
  };
  const resume = () => {
    setPaused(false);
  };

  return (
    // Pointer and focus handling only pauses the timer; it adds no interaction of its own.
    <div
      role="presentation"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <div
        role={toast.tone === 'alert' ? 'alert' : undefined}
        className="toast-in flex items-center gap-4 rounded-md border border-line bg-raised px-4 py-2 text-ink shadow-2"
      >
        <span>{toast.message}</span>
        {toast.actionLabel && toast.onAction ? (
          <button
            type="button"
            className="tap font-semibold text-accent underline underline-offset-2"
            onClick={() => {
              toast.onAction?.();
              onDismiss();
            }}
          >
            {toast.actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...options, id }]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  // `u` runs the Undo action of the newest toast that has one, while it is visible.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'u' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return;
      if (isTypingTarget(event.target)) return;
      const undoable = [...toasts].reverse().find((t) => t.onAction);
      if (!undoable) return;
      event.preventDefault();
      undoable.onAction?.();
      dismiss(undoable.id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toasts, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        data-testid="toast-region"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 wide:bottom-6"
      >
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastView
              toast={toast}
              onDismiss={() => {
                dismiss(toast.id);
              }}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
