import { once } from 'node:events';
import net from 'node:net';

async function availablePort(host = '127.0.0.1') {
  const server = net.createServer();
  server.unref();
  try {
    server.listen(0, host);
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string' || !Number.isInteger(address.port) || address.port <= 0) {
      throw new Error('Could not reserve an ephemeral test port.');
    }
    return address.port;
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
}

export { availablePort };
