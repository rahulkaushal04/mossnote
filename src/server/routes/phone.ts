import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { phoneEnabledSchema } from '@shared/schemas/phone';
import type { PairingCode, PhoneStatus } from '@shared/types';
import type { Env } from '../env';
import { AppError } from '../errors';
import { localOnly, PAIR_PATH } from '../middleware/access';
import { fromZod } from '../middleware/errors';
import { validateJson } from '../middleware/validate';
import type { PhoneAccess } from '../phone/types';

const validateDeviceId = zValidator('param', z.object({ id: z.string().max(40) }), (result) => {
  if (!result.success) throw fromZod(result.error);
});

function statusOf(phone: PhoneAccess, port: number): PhoneStatus {
  return {
    enabled: phone.isEnabled(),
    port,
    addresses: phone.addresses(),
    devices: phone.listDevices(),
  };
}

/**
 * Phone access, managed from the computer itself: turn it on or off, make a pairing code, and
 * see or remove the paired devices. A paired phone cannot use these routes. Where there is no
 * phone access to manage (the browser runtime), every route answers 404.
 */
export const phoneRoutes = (available: PhoneAccess | undefined, port: number) => {
  const phone = (): PhoneAccess => {
    if (!available) throw new AppError('not_found', 'Not found.');
    return available;
  };
  return new Hono<Env>()
    .use('*', localOnly(phone))
    .get('/', (c) => c.json(statusOf(phone(), port)))
    .put('/', validateJson(phoneEnabledSchema), (c) => {
      phone().setEnabled(c.req.valid('json').enabled);
      return c.json(statusOf(phone(), port));
    })
    .post('/code', (c) => {
      if (!phone().isEnabled()) {
        throw new AppError('conflict', 'Turn phone access on first.', {
          details: { reason: 'phone_access_off' },
        });
      }
      const issued = phone().issueCode();
      const body: PairingCode = {
        code: issued.code,
        expiresAt: new Date(issued.expiresAt).toISOString(),
        urls: phone()
          .addresses()
          .map((base) => `${base}${PAIR_PATH}?code=${issued.code.replace('-', '')}`),
      };
      return c.json(body);
    })
    .delete('/devices/:id', validateDeviceId, (c) => {
      if (!phone().revokeDevice(c.req.valid('param').id)) {
        throw new AppError('not_found', "That device isn't paired.");
      }
      return c.body(null, 204);
    })
    .delete('/devices', (c) => c.json({ removed: phone().revokeAllDevices() }));
};
