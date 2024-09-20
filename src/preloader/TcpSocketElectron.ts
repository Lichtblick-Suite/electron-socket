import net from "net";

import { dnsLookup } from "./dns.js";
import { Cloneable, RpcCall, RpcHandler, RpcResponse } from "../shared/Rpc.js";
import { TcpAddress } from "../shared/TcpTypes.js";

type MaybeHasFd = {
  _handle?: {
    fd?: number;
  };
};

export class TcpSocketElectron {
  readonly id: number;
  readonly host: string;
  readonly port: number;
  #socket: net.Socket;
  #messagePort: MessagePort;
  #api = new Map<string, RpcHandler>([
    [
      "remoteAddress",
      (callId) => {
        this.#apiResponse(callId, this.remoteAddress());
      },
    ],
    [
      "localAddress",
      (callId) => {
        this.#apiResponse(callId, this.localAddress());
      },
    ],
    [
      "fd",
      (callId) => {
        this.#apiResponse(callId, this.fd());
      },
    ],
    [
      "setKeepAlive",
      (callId, args) => {
        const enable = args[0] as boolean | undefined;
        const initialDelay = args[1] as number | undefined;
        this.setKeepAlive(enable, initialDelay);
        this.#apiResponse(callId);
      },
    ],
    [
      "setTimeout",
      (callId, args) => {
        const timeout = args[0] as number;
        this.setTimeout(timeout);
        this.#apiResponse(callId);
      },
    ],
    [
      "setNoDelay",
      (callId, args) => {
        const noDelay = args[0] as boolean | undefined;
        this.setNoDelay(noDelay);
        this.#apiResponse(callId);
      },
    ],
    [
      "connected",
      (callId) => {
        this.#apiResponse(callId, this.connected());
      },
    ],
    [
      "connect",
      (callId, _) => {
        this.connect()
          .then(() => {
            this.#apiResponse(callId, undefined);
          })
          .catch((err: Error) => {
            this.#apiResponse(callId, String(err.stack ?? err));
          });
      },
    ],
    [
      "close",
      (callId) => {
        this.#apiResponse(callId, this.close());
      },
    ],
    [
      "dispose",
      (callId) => {
        this.#apiResponse(callId, this.dispose());
      },
    ],
    [
      "write",
      (callId, args) => {
        const data = args[0] as Uint8Array;
        this.write(data)
          .then(() => {
            this.#apiResponse(callId, undefined);
          })
          .catch((err: Error) => {
            this.#apiResponse(callId, String(err.stack ?? err));
          });
      },
    ],
  ]);

  constructor(
    id: number,
    messagePort: MessagePort,
    host: string,
    port: number,
    socket: net.Socket,
  ) {
    this.id = id;
    this.host = host;
    this.port = port;
    this.#socket = socket;
    this.#messagePort = messagePort;

    this.#socket.on("close", () => {
      this.#emit("close");
    });
    this.#socket.on("end", () => {
      this.#emit("end");
    });
    this.#socket.on("data", this.#handleData);
    this.#socket.on("timeout", () => {
      this.#emit("timeout");
    });
    this.#socket.on("error", (err) => {
      this.#emit("error", String(err.stack ?? err));
    });

    messagePort.onmessage = (ev: MessageEvent<RpcCall>) => {
      const [methodName, callId] = ev.data;
      const args = ev.data.slice(2);
      const handler = this.#api.get(methodName);
      handler?.(callId, args);
    };
    messagePort.start();
  }

  remoteAddress(): TcpAddress | undefined {
    const port = this.#socket.remotePort;
    const family = this.#socket.remoteFamily;
    const address = this.#socket.remoteAddress;
    return port != null && address != null ? { port, family, address } : undefined;
  }

  localAddress(): TcpAddress | undefined {
    const port = this.#socket.localPort;
    const family = this.#socket.remoteFamily; // There is no localFamily
    const address = this.#socket.localAddress;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return port != null && address != null ? { port, family, address } : undefined;
  }

  fd(): number | undefined {
    // There is no public node.js API for retrieving the file descriptor for a
    // socket. This is the only way of retrieving it from pure JS, on platforms
    // where sockets have file descriptors. See
    // <https://github.com/nodejs/help/issues/1312>
    // eslint-disable-next-line no-underscore-dangle
    return (this.#socket as unknown as MaybeHasFd)._handle?.fd;
  }

  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  setKeepAlive(enable?: boolean, initialDelay?: number): this {
    this.#socket.setKeepAlive(enable, initialDelay);
    return this;
  }

  setTimeout(timeout: number): this {
    this.#socket.setTimeout(timeout);
    return this;
  }

  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  setNoDelay(noDelay?: boolean): this {
    this.#socket.setNoDelay(noDelay);
    return this;
  }

  connected(): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return !this.#socket.destroyed && this.#socket.localAddress != undefined;
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#socket
        .connect({ host: this.host, port: this.port, lookup: dnsLookup }, () => {
          this.#socket.removeListener("error", reject);
          resolve();
          this.#emit("connect");
        })
        .on("error", reject);
    });
  }

  close(): string {
    this.#socket.destroy();
    return "Connection closed";
  }

  dispose(): string {
    this.#socket.removeAllListeners();
    this.close();
    this.#messagePort.close();
    return "Connection disposed";
  }

  // Potentially performance-sensitive; await can be expensive
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#socket.write(data, (err) => {
        if (err != undefined) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  #apiResponse(callId: number, ...args: Cloneable[]): void {
    const msg: RpcResponse = [callId, ...args];
    this.#messagePort.postMessage(msg);
  }

  #emit(eventName: string, ...args: Cloneable[]): void {
    const msg: Cloneable[] = [eventName, ...args];
    this.#messagePort.postMessage(msg);
  }

  #handleData = (data: Uint8Array): void => {
    const msg: Cloneable[] = ["data", data];
    this.#messagePort.postMessage(msg, [data.buffer]);
  };
}
