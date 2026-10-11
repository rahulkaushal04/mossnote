import type { Listener } from '../listener';
import type { Logger } from '../logger';
import type { PhoneAccess } from './types';

export interface FollowOptions {
  phone: PhoneAccess;
  listener: Listener;
  /** The address to listen on while phone access is on or off. */
  hostFor: (phoneAccess: boolean) => string;
  /** Time for the answer to the request that asked for the change to reach the browser first. */
  delayMs: number;
  logger: Logger;
}

/** Moves the socket when phone access is switched, and records whether it now reaches the network. */
export function followPhoneAccess({ phone, listener, hostFor, delayMs, logger }: FollowOptions) {
  phone.onChange((phoneAccess) => {
    setTimeout(() => {
      listener
        .rebind(hostFor(phoneAccess))
        .then(() => {
          phone.setOpenToNetwork(phoneAccess);
          logger.info(phoneAccess ? 'Phone access is on.' : 'Phone access is off.');
        })
        .catch((error: unknown) => {
          logger.error('could not change the address Mossnote listens on', {
            reason: error instanceof Error ? error.message : String(error),
          });
        });
    }, delayMs);
  });
}
