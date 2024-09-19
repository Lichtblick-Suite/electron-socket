import net from "net";

import { TcpSocketElectron } from "./TcpSocketElectron.js";
import { nextId, registerEntity } from "./registry.js";
import { Cloneable, RpcCall, RpcHandler, RpcResponse } from "../shared/Rpc.js";
import { TcpAddress } from "../shared/TcpTypes.js";

export class TcpServerElectron {
  readonly id: number;
  #server: net.Server;
  #messagePort: MessagePort;
  #api = new Map<string, RpcHandler>([
    [
      "address",
      (callId) => {
        this.#apiResponse([callId, this.address()]);
      },
    ],
    [
      "listen",
      (callId, args) => {
        const port = args[0] as number | undefined;
        const hostname = args[1] as string | undefined;
        const backlog = args[2] as number | undefined;
        this.listen(port, hostname, backlog)
          .then(() => {
            this.#apiResponse([callId, undefined]);
          })
          .catch((err: Error) => {
            this.#apiResponse([callId, String(err.stack ?? err)]);
          });
      },
    ],
    [
      "close",
      (callId) => {
        this.close();
        this.#apiResponse([callId, undefined]);
      },
    ],
    [
      "dispose",
      (callId) => {
        this.dispose();
        this.#apiResponse([callId, undefined]);
      },
    ],
  ]);

  constructor(id: number, messagePort: MessagePort) {
    this.id = id;
    this.#server = net.createServer();
    this.#messagePort = messagePort;

    this.#server.on("close", () => {
      this.#emit("close");
    });
    this.#server.on("connection", (socket) => {
      this.#emitConnection(socket);
    });
    this.#server.on("error", (err) => {
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

  address(): TcpAddress | undefined {
    const addr = this.#server.address();
    if (addr == undefined || typeof addr === "string") {
      // Address will only be a string for an IPC (named pipe) server, which
      // should never happen here
      return undefined;
    }
    return addr;
  }

  async listen(port?: number, hostname?: string, backlog?: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.listen(port, hostname, backlog, () => {
        this.#server.removeListener("error", reject);
        resolve();
      });
    });
  }

  close(): void {
    this.#server.close();
  }

  dispose(): void {
    this.#server.removeAllListeners();
    this.close();
    this.#messagePort.close();
  }

  #apiResponse(message: RpcResponse, transfer?: Transferable[]): void {
    if (transfer != undefined) {
      this.#messagePort.postMessage(message, transfer);
    } else {
      this.#messagePort.postMessage(message);
    }
  }

  #emit(eventName: string, ...args: Cloneable[]): void {
    const msg = [eventName, ...args];
    this.#messagePort.postMessage(msg);
  }

  #emitConnection(socket: net.Socket): void {
    const id = nextId();
    const channel = new MessageChannel();
    const host = socket.remoteAddress!;
    const port = socket.remotePort!;
    const electronSocket = new TcpSocketElectron(id, channel.port2, host, port, socket);
    registerEntity(id, electronSocket);
    this.#messagePort.postMessage(["connection"], [channel.port1]);
  }
}
