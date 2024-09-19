import http from "http";

import { HttpRequest, HttpResponse } from "../shared/HttpTypes.js";
import { Cloneable, RpcCall, RpcHandler, RpcResponse } from "../shared/Rpc.js";
import { TcpAddress } from "../shared/TcpTypes.js";

export class HttpServerElectron {
  readonly id: number;
  #server: http.Server;
  #messagePort: MessagePort;
  #nextRequestId = 0;
  #requests = new Map<number, (response: HttpResponse) => Promise<void>>();
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
      "response",
      (callId, args) => {
        const requestId = args[0] as number;
        const response = args[1] as HttpResponse;
        const handler = this.#requests.get(requestId);
        if (handler == undefined) {
          this.#apiResponse([callId, `unknown requestId ${requestId}`]);
          return;
        }
        this.#requests.delete(requestId);
        handler(response)
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
    this.#server = http.createServer(this.#handleRequest);
    this.#messagePort = messagePort;

    this.#server.on("close", () => {
      this.#emit("close");
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

  #handleRequest = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();

      const requestId = this.#nextRequestId++;
      this.#requests.set(requestId, async (out): Promise<void> => {
        res.shouldKeepAlive = out.shouldKeepAlive ?? res.shouldKeepAlive;
        res.statusCode = out.statusCode;
        res.statusMessage = out.statusMessage ?? "";
        res.sendDate = out.sendDate ?? res.sendDate;
        let hasContentLength = false;
        for (const [key, value] of Object.entries(out.headers ?? {})) {
          if (!hasContentLength && key.toLowerCase() === "content-length") {
            hasContentLength = true;
          }
          res.setHeader(key, value);
        }
        if (out.body != undefined && !hasContentLength) {
          res.setHeader("Content-Length", Buffer.byteLength(out.body));
        }
        res.end(out.body);
      });

      const request: HttpRequest = {
        body,
        aborted: req.aborted,
        httpVersion: req.httpVersion,
        httpVersionMajor: req.httpVersionMajor,
        httpVersionMinor: req.httpVersionMinor,
        complete: req.complete,
        headers: req.headers,
        rawHeaders: req.rawHeaders,
        trailers: req.trailers,
        rawTrailers: req.rawTrailers,
        method: req.method,
        url: req.url,
        socket: {
          localAddress: req.socket.localAddress,
          localPort: req.socket.localPort,
          remoteAddress: req.socket.remoteAddress,
          remotePort: req.socket.remotePort,
        },
      };
      this.#emit("request", requestId, request);
    });
  };
}
