// Loaded with --import after short-connect.ts: tls.connect returns a socket
// whose TCP connect never completes, with no network blackhole address.
import { Socket } from 'node:net';
import tls, { type TLSSocket } from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

tls.connect = (() => new Socket() as TLSSocket) as typeof tls.connect;
syncBuiltinESMExports();
