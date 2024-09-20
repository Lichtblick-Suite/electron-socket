import dgram from "dgram";

import { Cloneable, RpcCall, RpcHandler, RpcResponse } from "../shared/Rpc.js";
import { UdpAddress } from "../shared/UdpTypes.js";

type MaybeHasFd = {
  _handle?: {
    fd?: number;
  };
};

export class UdpSocketElectron {
  readonly id: number;
  #socket: dgram.Socket;
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
      "addMembership",
      (callId, args) => {
        const multicastAddress = args[0] as string;
        const multicastInterface = args[1] as string | undefined;
        this.addMembership(multicastAddress, multicastInterface);
        this.#apiResponse(callId);
      },
    ],
    [
      "addSourceSpecificMembership",
      (callId, args) => {
        const sourceAddress = args[0] as string;
        const groupAddress = args[1] as string;
        const multicastInterface = args[2] as string | undefined;
        this.addSourceSpecificMembership(sourceAddress, groupAddress, multicastInterface);
        this.#apiResponse(callId);
      },
    ],
    [
      "bind",
      (callId, args) => {
        const options = args[0] as {
          port?: number;
          address?: string;
          exclusive?: boolean;
          fd?: number;
        };
        this.bind(options)
          .then(() => {
            this.#apiResponse(callId, undefined);
          })
          .catch((err: Error) => {
            this.#apiResponse(callId, String(err.stack ?? err));
          });
      },
    ],
    [
      "setBroadcast",
      (callId, args) => {
        const enable = args[0] as boolean;
        this.setBroadcast(enable);
        this.#apiResponse(callId);
      },
    ],
    [
      "setMulticastInterface",
      (callId, args) => {
        const multicastInterface = args[0] as string;
        this.setMulticastInterface(multicastInterface);
        this.#apiResponse(callId);
      },
    ],
    [
      "setMulticastLoopback",
      (callId, args) => {
        const enable = args[0] as boolean;
        this.setMulticastLoopback(enable);
        this.#apiResponse(callId);
      },
    ],
    [
      "setMulticastTTL",
      (callId, args) => {
        const ttl = args[0] as number;
        this.setMulticastTTL(ttl);
        this.#apiResponse(callId);
      },
    ],
    [
      "setRecvBufferSize",
      (callId, args) => {
        const size = args[0] as number;
        this.setRecvBufferSize(size);
        this.#apiResponse(callId);
      },
    ],
    [
      "setSendBufferSize",
      (callId, args) => {
        const size = args[0] as number;
        this.setSendBufferSize(size);
        this.#apiResponse(callId);
      },
    ],
    [
      "setTTL",
      (callId, args) => {
        const ttl = args[0] as number;
        this.setTTL(ttl);
        this.#apiResponse(callId);
      },
    ],
    [
      "connect",
      (callId, args) => {
        const port = args[0] as number;
        const address = args[1] as string | undefined;
        this.connect(port, address)
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
        this.close()
          .then(() => {
            this.#apiResponse(callId, undefined);
          })
          .catch((err: Error) => {
            this.#apiResponse(callId, String(err.stack ?? err));
          });
      },
    ],
    [
      "disconnect",
      (callId) => {
        // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
        this.#apiResponse(callId, this.disconnect());
      },
    ],
    [
      "dropMembership",
      (callId, args) => {
        const multicastAddress = args[0] as string;
        const multicastInterface = args[1] as string | undefined;
        this.dropMembership(multicastAddress, multicastInterface);
        this.#apiResponse(callId);
      },
    ],
    [
      "dropSourceSpecificMembership",
      (callId, args) => {
        const sourceAddress = args[0] as string;
        const groupAddress = args[1] as string;
        const multicastInterface = args[2] as string | undefined;
        this.dropSourceSpecificMembership(sourceAddress, groupAddress, multicastInterface);
        this.#apiResponse(callId);
      },
    ],
    [
      "dispose",
      (callId) => {
        this.#apiResponse(callId, this.dispose());
      },
    ],
    [
      "send",
      (callId, args) => {
        const msg = args[0] as Uint8Array;
        const offset = args[1] as number | undefined;
        const length = args[2] as number | undefined;
        const port = args[3] as number | undefined;
        const address = args[4] as string | undefined;
        this.send(msg, offset, length, port, address)
          .then(() => {
            this.#apiResponse(callId, undefined);
          })
          .catch((err: Error) => {
            this.#apiResponse(callId, String(err.stack ?? err));
          });
      },
    ],
  ]);

  constructor(id: number, messagePort: MessagePort, socket: dgram.Socket) {
    this.id = id;
    this.#socket = socket;
    this.#messagePort = messagePort;

    this.#socket.on("close", () => {
      this.#emit("close");
    });
    this.#socket.on("connect", () => {
      this.#emit("connect");
    });
    this.#socket.on("message", this.#handleMessage);
    this.#socket.on("listening", () => {
      this.#emit("listening");
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

  remoteAddress(): UdpAddress | undefined {
    try {
      const { port, family, address } = this.#socket.remoteAddress();
      return { port, family, address };
    } catch {
      return undefined;
    }
  }

  localAddress(): UdpAddress | undefined {
    try {
      const { port, family, address } = this.#socket.address();
      return { port, family, address };
    } catch {
      return undefined;
    }
  }

  fd(): number | undefined {
    // There is no public node.js API for retrieving the file descriptor for a
    // socket. This is the only way of retrieving it from pure JS, on platforms
    // where sockets have file descriptors. See
    // <https://github.com/nodejs/help/issues/1312>
    // eslint-disable-next-line no-underscore-dangle
    return (this.#socket as unknown as MaybeHasFd)._handle?.fd;
  }

  addMembership(multicastAddress: string, multicastInterface?: string): void {
    this.#socket.addMembership(multicastAddress, multicastInterface);
  }

  addSourceSpecificMembership(
    sourceAddress: string,
    groupAddress: string,
    multicastInterface?: string,
  ): void {
    this.#socket.addSourceSpecificMembership(sourceAddress, groupAddress, multicastInterface);
  }

  async bind(options: dgram.BindOptions): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#socket.on("error", reject).bind(options, () => {
        this.#socket.removeListener("error", reject);
        resolve();
      });
    });
  }

  async connect(port: number, address?: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#socket.on("error", reject).connect(port, address, () => {
        this.#socket.removeListener("error", reject);
        resolve();
        this.#emit("connect");
      });
    });
  }

  async close(): Promise<void> {
    await new Promise((resolve) => {
      this.#socket.close(() => resolve);
    });
  }

  disconnect(): void {
    this.#socket.disconnect();
  }

  dispose(): string {
    this.#socket.removeAllListeners();
    void this.close();
    this.#messagePort.close();
    return "Connection disposed";
  }

  dropMembership(multicastAddress: string, multicastInterface?: string): void {
    this.#socket.dropMembership(multicastAddress, multicastInterface);
  }

  dropSourceSpecificMembership(
    sourceAddress: string,
    groupAddress: string,
    multicastInterface?: string,
  ): void {
    this.#socket.dropSourceSpecificMembership(sourceAddress, groupAddress, multicastInterface);
  }

  async send(
    msg: Uint8Array,
    offset = 0,
    length = msg.byteLength,
    port?: number,
    address?: string,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#socket.send(msg, offset, length, port, address, (err) => {
        if (err != undefined) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  setBroadcast(flag: boolean): void {
    this.#socket.setBroadcast(flag);
  }

  setMulticastInterface(multicastInterface: string): void {
    this.#socket.setMulticastInterface(multicastInterface);
  }

  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  setMulticastLoopback(flag: boolean): void {
    this.#socket.setMulticastLoopback(flag);
  }

  setMulticastTTL(ttl: number): void {
    this.#socket.setMulticastTTL(ttl);
  }

  setRecvBufferSize(size: number): void {
    this.#socket.setRecvBufferSize(size);
  }

  setSendBufferSize(size: number): void {
    this.#socket.setSendBufferSize(size);
  }

  setTTL(ttl: number): void {
    this.#socket.setTTL(ttl);
  }

  #apiResponse(callId: number, ...args: Cloneable[]): void {
    const msg: RpcResponse = [callId, ...args];
    this.#messagePort.postMessage(msg);
  }

  #emit(eventName: string, ...args: Cloneable[]): void {
    const msg: Cloneable[] = [eventName, ...args];
    this.#messagePort.postMessage(msg);
  }

  #handleMessage = (data: Uint8Array, rinfo: dgram.RemoteInfo): void => {
    const cloneableRinfo = { ...rinfo } as Cloneable;
    const msg: Cloneable[] = ["message", data, cloneableRinfo];
    this.#messagePort.postMessage(msg, [data.buffer]);
  };
}
