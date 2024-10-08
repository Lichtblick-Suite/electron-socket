# @lichtblick/electron-socket

Networking sockets for Electron apps

[![npm version](https://img.shields.io/npm/v/@lichtblick/electron-socket.svg?style=flat)](https://www.npmjs.com/package/@lichtblick/electron-socket)

## Introduction

Raw sockets are not supported in browser contexts, even in Electron apps. To overcome this limitation, this package uses RPC between the Electron renderer context (referred to in this package as the "renderer" and in Electron documentation as "main world") and the preloader (referred to in Electron documentation as "isolated world" when running with `contextIsolation: true`) to expose TCP/UDP sockets and server classes in the renderer context. The API somewhat resembles `net.Socket`/`dgram.Socket` and `net.Server` from node.js, with Promise-based methods since these classes are built on asynchronous RPC.

## Usage

```ts
// preload.ts ////////////////////////////////////////////////////////////////
import { PreloaderSockets } from "@lichtblick/electron-socket/preloader";

PreloaderSockets.Create();
```

```ts
// renderer.ts ///////////////////////////////////////////////////////////////
import { Sockets } from "@lichtblick/electron-socket/renderer";

async function main() {
  const net = await Sockets.Create();

  const server = await net.createServer();
  server.on("connection", (client) => {
    client.write(new Uint8Array([42]));
  });
  server.listen(9000);

  const socket = await net.createSocket();
  socket.on("data", (data: Uint8Array) => console.log(`Server sent ${data}`));
  socket.connect({ port: 9000, host: "localhost" });
}

main();
```

## License

@lichtblick/electron-socket is licensed under the [MIT License](https://opensource.org/licenses/MIT).

## Development

### Testing

A small example Electron app is provided in the [example](example) directory, which can be used for manual testing. Run it using `yarn example`.

### Releasing

1. Run `yarn version --[major|minor|patch]` to bump version
2. Run `git push && git push --tags` to push new tag
3. GitHub Actions will take care of the rest