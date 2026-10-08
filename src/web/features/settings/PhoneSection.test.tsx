// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PairedDevice, PairingCode, PhoneStatus } from '@shared/types';
import { api, ApiError } from '../../lib/api';
import { mockApi, renderWithProviders, settingsFixture } from '../../testing';
import { PhoneSection } from './PhoneSection';

const device = (overrides: Partial<PairedDevice> = {}): PairedDevice => ({
  id: 'abc123',
  name: 'iPhone (Safari)',
  pairedAt: '2026-01-01T10:00:00.000Z',
  lastSeenAt: '2026-01-02T10:00:00.000Z',
  ...overrides,
});

const status = (overrides: Partial<PhoneStatus> = {}): PhoneStatus => ({
  enabled: true,
  port: 4317,
  addresses: ['http://192.168.1.20:4317'],
  devices: [],
  ...overrides,
});

const CODE: PairingCode = {
  code: 'ABCDE-FGHJK',
  expiresAt: '2026-01-02T10:10:00.000Z',
  urls: ['http://192.168.1.20:4317/pair?code=ABCDEFGHJK'],
};

beforeEach(() => {
  mockApi(settingsFixture());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const show = (phone: PhoneStatus) => {
  vi.spyOn(api, 'getPhone').mockResolvedValue(phone);
  return renderWithProviders(<PhoneSection />);
};

describe('Settings → Phone', () => {
  it('shows the switch off, and nothing to pair, while phone access is off', async () => {
    show(status({ enabled: false, addresses: [] }));

    const toggle = await screen.findByRole('checkbox', { name: /let phones and tablets/i });

    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('button', { name: /show pairing code/i })).toBeNull();
  });

  it('asks the server to turn phone access on', async () => {
    const set = vi.spyOn(api, 'setPhoneAccess').mockResolvedValue(status());
    show(status({ enabled: false, addresses: [] }));

    await userEvent.click(await screen.findByRole('checkbox', { name: /let phones and tablets/i }));

    expect(set).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('says plainly when the computer is not on a network', async () => {
    show(status({ addresses: [] }));

    expect(await screen.findByText(/doesn.t seem to be connected to a network/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /show pairing code/i })).toBeNull();
  });

  it('shows a QR code, the address and the code to type', async () => {
    vi.spyOn(api, 'makePairingCode').mockResolvedValue(CODE);
    show(status());

    await userEvent.click(await screen.findByRole('button', { name: /show pairing code/i }));

    expect(await screen.findByRole('img', { name: /pairing link/i })).toBeTruthy();
    expect(screen.getByText('ABCDE-FGHJK')).toBeTruthy();
    expect(screen.getByText('http://192.168.1.20:4317/pair')).toBeTruthy();
  });

  it('lets the person pick the address their phone is on when there are several', async () => {
    vi.spyOn(api, 'makePairingCode').mockResolvedValue({
      ...CODE,
      urls: [...CODE.urls, 'http://10.0.0.5:4317/pair?code=ABCDEFGHJK'],
    });
    show(status({ addresses: ['http://192.168.1.20:4317', 'http://10.0.0.5:4317'] }));
    await userEvent.click(await screen.findByRole('button', { name: /show pairing code/i }));

    await userEvent.click(await screen.findByRole('radio', { name: '10.0.0.5:4317' }));

    expect(screen.getByRole('img', { name: /10\.0\.0\.5/ })).toBeTruthy();
  });

  it('closes the code when done', async () => {
    vi.spyOn(api, 'makePairingCode').mockResolvedValue(CODE);
    show(status());
    await userEvent.click(await screen.findByRole('button', { name: /show pairing code/i }));

    await userEvent.click(await screen.findByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('img', { name: /pairing link/i })).toBeNull();
    expect(screen.getByRole('button', { name: /show pairing code/i })).toBeTruthy();
  });

  it('lists the paired devices and removes one', async () => {
    const remove = vi.spyOn(api, 'removeDevice').mockResolvedValue(undefined);
    show(status({ devices: [device()] }));

    const list = await screen.findByRole('list', { name: 'Paired devices' });
    expect(within(list).getByText('iPhone (Safari)')).toBeTruthy();
    await userEvent.click(within(list).getByRole('button', { name: 'Remove iPhone (Safari)' }));

    expect(remove).toHaveBeenCalledExactlyOnceWith('abc123');
  });

  it('asks before removing every device', async () => {
    const removeAll = vi.spyOn(api, 'removeAllDevices').mockResolvedValue({ removed: 2 });
    show(status({ devices: [device(), device({ id: 'def456', name: 'iPad (Safari)' })] }));

    await userEvent.click(await screen.findByRole('button', { name: 'Remove all devices' }));
    expect(removeAll).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove all' }));

    expect(removeAll).toHaveBeenCalledOnce();
  });

  it('shows the server’s message when a request fails', async () => {
    vi.spyOn(api, 'makePairingCode').mockRejectedValue(
      new ApiError(409, { code: 'conflict', message: 'Turn phone access on first.' }),
    );
    show(status());

    await userEvent.click(await screen.findByRole('button', { name: /show pairing code/i }));

    expect((await screen.findByRole('alert')).textContent).toBe('Turn phone access on first.');
  });

  it('tells a paired phone that phone access is managed on the computer', async () => {
    vi.spyOn(api, 'getPhone').mockRejectedValue(
      new ApiError(403, { code: 'forbidden', message: 'Phone access can only be managed here.' }),
    );
    renderWithProviders(<PhoneSection />);

    await waitFor(() => {
      expect(screen.getByText(/managed on that computer/i)).toBeTruthy();
    });
  });
});
