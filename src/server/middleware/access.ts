import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { AppError } from '../errors';
import type { PhoneAccess } from '../phone/types';
import { peerAddress } from './peer';

/** The cookie that carries a paired device's session token. */
export const SESSION_COOKIE = 'moss_session';

/** Where a phone is sent to pair, and the only path it may open without being paired. */
export const PAIR_PATH = '/pair';

/** The network can reach the app: phone access is on, or the socket has not left the network yet. */
const onNetwork = (phone: PhoneAccess): boolean => phone.isEnabled() || phone.isOpenToNetwork();

/**
 * Who may use the app while the network can reach it.
 *  - This computer is trusted, exactly as when the server only listens on loopback.
 *  - Any other device needs the session cookie that pairing sets. Without it, the API answers
 *    401 and a page request is sent to the pairing page.
 * It fails closed: a request whose peer cannot be determined counts as another device.
 */
export function access(phone: PhoneAccess): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!onNetwork(phone) || phone.isLocalPeer(peerAddress(c))) return next();

    const path = new URL(c.req.url).pathname;
    if (path === PAIR_PATH || path.startsWith(`${PAIR_PATH}/`)) return next();

    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined && phone.authenticate(token)) return next();

    if (path.startsWith('/api')) {
      throw new AppError('unauthorized', 'This device is not paired with this computer.');
    }
    return c.redirect(PAIR_PATH, 303);
  };
}

/**
 * For routes only the computer itself may use: pairing codes, the list of devices, and showing the
 * data folder on its screen. Takes a function because there may be no phone access (the browser
 * runtime): the phone routes then throw their own "not found" from it, and a route that has
 * another use passes, since there is no other device to keep out.
 */
export function localOnly(phone: () => PhoneAccess | undefined): MiddlewareHandler<Env> {
  return async (c, next) => {
    const access = phone();
    if (!access || access.isLocalPeer(peerAddress(c)) || !onNetwork(access)) return next();
    throw new AppError('forbidden', 'This can only be done on the computer itself.');
  };
}
