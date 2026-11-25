import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { connect, type TLSSocket } from 'node:tls';

export class PinMismatch extends Error {}
// The TCP connect did not complete in time.
export class ConnectTimeout extends Error {}
// TCP connected, the TLS handshake did not complete in time.
export class HandshakeTimeout extends Error {}

// Opens TLS and resolves only when the SHA-256 of the server's leaf
// certificate in DER form equals the pin. Trust comes from the pin alone: no
// CA, no system roots and no host name check. The caller writes the request
// only to the resolved socket, so no request byte, and so no bearer, reaches
// a peer whose certificate did not match.
export function connectPinned(host: string, port: number, pin: Buffer, timeoutMs = 10_000): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const sock = connect({
      host,
      port,
      servername: isIP(host) ? undefined : host,
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
    });
    let connected = false;
    sock.once('connect', () => (connected = true));
    const onTimeout = (): void => {
      sock.destroy(connected ? new HandshakeTimeout() : new ConnectTimeout());
    };
    sock.setTimeout(timeoutMs, onTimeout);
    sock.once('error', reject);
    sock.once('secureConnect', () => {
      const der = sock.getPeerCertificate().raw;
      const got = der ? createHash('sha256').update(der).digest() : Buffer.alloc(0);
      if (got.length !== pin.length || !timingSafeEqual(got, pin)) {
        sock.destroy();
        reject(new PinMismatch());
        return;
      }
      // Removed by reference: the caller sets its own idle timeout later, and
      // that one must never end as a handshake timeout.
      sock.setTimeout(0);
      sock.removeListener('timeout', onTimeout);
      sock.removeListener('error', reject);
      resolve(sock);
    });
  });
}
