import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PairedDevice, PairingCode } from '@shared/types';
import { api, ApiError } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { PairedDevices } from './PairedDevices';
import { PairingPanel } from './PairingPanel';

/**
 * Time for the server to move to the network address after it was asked to, before the status is
 * read again. The server answers first and moves a moment later.
 */
const SETTLE_MS = 600;

const problemFrom = (error: unknown, fallback: string): string =>
  error instanceof ApiError ? error.message : fallback;

/**
 * Settings → Phone. Lets phones and tablets on the same network open the journal that lives on
 * this computer: the person turns it on, shows a pairing code, scans it, and the device is paired.
 */
export function PhoneSection() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.phone, queryFn: api.getPhone, retry: false });
  const [code, setCode] = useState<PairingCode | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // What the switch shows while a change is on its way, so it answers the click at once.
  const [requested, setRequested] = useState<boolean | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.phone });
  const report = (error: unknown, fallback: string) => {
    setProblem(problemFrom(error, fallback));
  };

  const setEnabled = (enabled: boolean) => {
    setProblem(null);
    setCode(null);
    setRequested(enabled);
    api
      .setPhoneAccess(enabled)
      .then(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)))
      .then(refresh)
      .catch((error: unknown) => {
        report(error, "Couldn't change phone access.");
      })
      .finally(() => {
        setRequested(null);
      });
  };

  const showCode = () => {
    setProblem(null);
    api
      .makePairingCode()
      .then(setCode)
      .catch((error: unknown) => {
        report(error, "Couldn't make a pairing code.");
      });
  };

  const removeDevice = (device: PairedDevice) => {
    setProblem(null);
    api
      .removeDevice(device.id)
      .then(refresh)
      .catch((error: unknown) => {
        report(error, "Couldn't remove that device.");
      });
  };

  const removeAll = () => {
    setProblem(null);
    api
      .removeAllDevices()
      .then(refresh)
      .catch((error: unknown) => {
        report(error, "Couldn't remove the devices.");
      });
  };

  if (status.error instanceof ApiError && status.error.status === 403) {
    return (
      <p className="m-0">
        This device is paired with the computer that runs Mossnote. Phone access is managed on that
        computer, in Settings.
      </p>
    );
  }
  if (status.isPending) return null;
  if (status.isError) {
    return (
      <p role="alert" className="text-danger">
        Couldn&apos;t read the phone access settings.
      </p>
    );
  }

  const { addresses, devices } = status.data;
  // The switch follows the click at once; what hangs off it waits for the server's answer.
  const switchOn = requested ?? status.data.enabled;
  const enabled = requested === null && status.data.enabled;

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0">
        Keep your notes on a phone or tablet while you play on this computer. The journal stays on
        this computer, and your phone opens it over your home network.
      </p>

      <label className="tap flex items-start gap-3">
        <input
          type="checkbox"
          checked={switchOn}
          onChange={(e) => {
            setEnabled(e.target.checked);
          }}
          className="mt-1 size-4 accent-accent"
        />
        <span>
          Let phones and tablets on my network open Mossnote
          <span className="block text-sm text-ink-muted">
            Only devices you pair can use it. The connection is not encrypted, so use it on a
            network you trust, such as your home Wi-Fi. If your computer asks about a firewall,
            allow Mossnote on private networks.
          </span>
        </span>
      </label>

      {problem ? (
        <p role="alert" className="text-danger">
          {problem}
        </p>
      ) : null}

      {enabled && addresses.length === 0 ? (
        <p role="status" className="m-0">
          This computer doesn&apos;t seem to be connected to a network, so a phone can&apos;t reach
          it yet.
        </p>
      ) : null}

      {enabled && addresses.length > 0 ? (
        <>
          {code ? (
            <PairingPanel
              code={code}
              onDone={() => {
                setCode(null);
                void refresh();
              }}
            />
          ) : (
            <div>
              <button type="button" className="btn tap" onClick={showCode}>
                Show pairing code
              </button>
            </div>
          )}
          <PairedDevices devices={devices} onRemove={removeDevice} onRemoveAll={removeAll} />
        </>
      ) : null}
    </div>
  );
}
