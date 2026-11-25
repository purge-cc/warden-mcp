// Loaded with --import into a bridge under test: its one-minute idle timeout
// becomes 300 ms, so a stalled server costs the test well under a second. Any
// other timeout, such as the 10-second handshake one, stays as it is.
import { Socket } from 'node:net';

const setTimeout = Socket.prototype.setTimeout;
Socket.prototype.setTimeout = function (this: Socket, ms: number, callback?: () => void) {
  return setTimeout.call(this, ms === 60_000 ? 300 : ms, callback);
};
