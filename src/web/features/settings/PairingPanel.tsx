import { useState } from 'react';
import type { PairingCode } from '@shared/types';
import { formatDateTime } from '../../lib/format';
import { QrCode } from './QrCode';

interface PairingPanelProps {
  code: PairingCode;
  onDone: () => void;
}

/**
 * The one-time code for pairing a phone: a QR code to scan with its camera, the same link as
 * text, and the code to type if scanning is not possible. With several network addresses the
 * person picks the one their phone is on.
 */
export function PairingPanel({ code, onDone }: PairingPanelProps) {
  const [chosen, setChosen] = useState(0);
  const url = code.urls[chosen] ?? code.urls[0];
  const pairPage = url ? new URL(url) : null;

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-4">
      <h3 className="m-0 font-semibold">Pair a phone or tablet</h3>
      <ol className="m-0 ml-5 flex list-decimal flex-col gap-1">
        <li>Connect the phone to the same Wi-Fi as this computer.</li>
        <li>Scan this code with the phone&apos;s camera and open the link.</li>
      </ol>
      {url ? (
        <QrCode text={url} label={`Pairing link ${url}`} className="size-56 self-start" />
      ) : null}
      {code.urls.length > 1 ? (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="text-sm text-ink-muted">
            This computer has more than one network address. Pick the one your phone is on:
          </legend>
          {code.urls.map((candidate, index) => (
            <label key={candidate} className="tap flex items-center gap-2">
              <input
                type="radio"
                name="pairing-address"
                checked={index === chosen}
                onChange={() => {
                  setChosen(index);
                }}
                className="size-4 accent-accent"
              />
              <span className="break-all">{new URL(candidate).host}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <p className="m-0 text-sm text-ink-muted">
        Can&apos;t scan it? On the phone, open{' '}
        <span className="font-medium break-all">
          {pairPage ? `${pairPage.origin}${pairPage.pathname}` : 'the address shown'}
        </span>{' '}
        and type the code <strong className="font-mono tracking-wider text-ink">{code.code}</strong>
        .
      </p>
      <p className="m-0 text-sm text-ink-muted">
        The code works once and expires at {formatDateTime(code.expiresAt)}.
      </p>
      <div>
        <button type="button" className="btn tap" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
