// Loaded with --import into a bridge under test: the 10-second connect and
// handshake timeout becomes 300 ms. The one-minute idle timeout stays as it is.
import { Socket } from 'node:net';

const setTimeout = Socket.prototype.setTimeout;
Socket.prototype.setTimeout = function (this: Socket, ms: number, callback?: () => void) {
  return setTimeout.call(this, ms === 10_000 ? 300 : ms, callback);
};
