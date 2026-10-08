import { useEffect, useState } from 'react';
import { formatBytes } from '../lib/format';
import {
  readStorageProtection,
  requestPersistentStorage,
  type StorageProtection as Protection,
} from './persist';

/**
 * Standalone web app only, in Settings → Data & backup: whether the browser has promised not to
 * clear the journal, with a button to ask again.
 */
export function StorageProtection() {
  const [state, setState] = useState<Protection | null>(null);

  useEffect(() => {
    let current = true;
    void readStorageProtection().then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, []);

  if (state === null) return null;
  const ask = () => {
    void requestPersistentStorage().then(readStorageProtection).then(setState);
  };

  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-semibold">Protection from clean-ups</h3>
      {state.persisted ? (
        <p className="m-0">
          This browser has promised to keep your journal, even when the device runs low on space.
        </p>
      ) : (
        <>
          <p className="m-0">
            This browser may clear your journal if the device runs low on space. Downloading a copy
            is the only sure protection. Adding Mossnote to your Home Screen or dock usually makes
            browsers keep it.
          </p>
          <div>
            <button type="button" className="btn tap text-sm" onClick={ask}>
              Ask the browser to keep it
            </button>
          </div>
        </>
      )}
      {state.usage !== null && state.quota !== null ? (
        <p className="m-0 text-sm text-ink-muted">
          Using {formatBytes(state.usage)} of the {formatBytes(state.quota)} this site may use.
        </p>
      ) : null}
    </div>
  );
}
