import { useState } from 'react';
import type { PairedDevice } from '@shared/types';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { formatDateTime } from '../../lib/format';

interface PairedDevicesProps {
  devices: readonly PairedDevice[];
  onRemove: (device: PairedDevice) => void;
  onRemoveAll: () => void;
}

/** The phones and tablets that can open this journal, with a way to cut each one off. */
export function PairedDevices({ devices, onRemove, onRemoveAll }: PairedDevicesProps) {
  const [confirmingAll, setConfirmingAll] = useState(false);

  return (
    <div>
      <h3 className="font-semibold">Paired devices</h3>
      {devices.length === 0 ? (
        <p className="text-ink-muted">No device is paired yet.</p>
      ) : (
        <>
          <ul aria-label="Paired devices" className="m-0 list-none p-0">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line py-2"
              >
                <span className="min-w-40 font-medium">{device.name}</span>
                <span className="text-sm text-ink-muted">
                  Last used{' '}
                  <time dateTime={device.lastSeenAt}>{formatDateTime(device.lastSeenAt)}</time>
                </span>
                <button
                  type="button"
                  className="tap ml-auto rounded-md px-2 text-sm underline"
                  aria-label={`Remove ${device.name}`}
                  onClick={() => {
                    onRemove(device);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {devices.length > 1 ? (
            <div className="mt-2">
              <button
                type="button"
                className="btn tap text-sm"
                onClick={() => {
                  setConfirmingAll(true);
                }}
              >
                Remove all devices
              </button>
              <ConfirmDialog
                open={confirmingAll}
                onOpenChange={setConfirmingAll}
                title="Remove every paired device?"
                message="Each phone and tablet will need to be paired again before it can open Mossnote."
                confirmLabel="Remove all"
                danger
                onConfirm={onRemoveAll}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
