import EventEmitter from "eventemitter3";

import { Cloneable, RpcCall, RpcEvent, RpcResponse } from "../shared/Rpc.js";
import { UdpAddress, UdpBindOptions, UdpRemoteInfo } from "../shared/UdpTypes.js";

export interface UdpSocketRendererEvents {
  connect: () => void;
  close: () => void;
  listening: () => void;
  error: (err: Error) => void;
  message: (data: Uint8Array, rinfo: UdpRemoteInfo) => void;
}

export class UdpSocketRenderer extends EventEmitter<UdpSocketRendererEvents> {
  #messagePort: MessagePort;
  #callbacks = new Map<number, (result: Cloneable[]) => void>();
  #nextCallId = 0;
  #eventMap = new Map<string, (args: Cloneable[], ports?: readonly MessagePort[]) => void>([
    ["connect", () => this.emit("connect")],
    ["close", () => this.emit("close")],
    ["listening", () => this.emit("listening")],
    ["error", (args) => this.emit("error", new Error(args[0] as string))],
    ["message", (args) => this.emit("message", args[0] as Uint8Array, args[1] as UdpRemoteInfo)],
  ]);

  constructor(messagePort: MessagePort) {
    super();
    this.#messagePort = messagePort;

    messagePort.onmessage = (ev: MessageEvent<RpcResponse | RpcEvent>) => {
      const args = ev.data.slice(1);
      if (typeof ev.data[0] === "number") {
        // RpcResponse
        const callId = ev.data[0];
        const callback = this.#callbacks.get(callId);
        if (callback != undefined) {
          this.#callbacks.delete(callId);
          callback(args);
        }
      } else {
        // RpcEvent
        const eventName = ev.data[0];
        const handler = this.#eventMap.get(eventName);
        handler?.(args, ev.ports);
      }
    };
    messagePort.start();
  }

  async remoteAddress(): Promise<UdpAddress | undefined> {
    const res = await this.#apiCall("remoteAddress");
    return res[0] as UdpAddress | undefined;
  }

  async localAddress(): Promise<UdpAddress | undefined> {
    const res = await this.#apiCall("localAddress");
    return res[0] as UdpAddress | undefined;
  }

  async fd(): Promise<number | undefined> {
    const res = await this.#apiCall("fd");
    return res[0] as number | undefined;
  }

  async addMembership(multicastAddress: string, multicastInterface?: string): Promise<void> {
    await this.#apiCall("addMembership", multicastAddress, multicastInterface);
  }

  async addSourceSpecificMembership(
    sourceAddress: string,
    groupAddress: string,
    multicastInterface?: string,
  ): Promise<void> {
    await this.#apiCall(
      "addSourceSpecificMembership",
      sourceAddress,
      groupAddress,
      multicastInterface,
    );
  }

  async bind(options: UdpBindOptions): Promise<void> {
    const res = await this.#apiCall("bind", options);
    if (res[0] != undefined) {
      throw new Error(res[0] as string);
    }
  }

  async connect(port: number, address?: string): Promise<void> {
    const res = await this.#apiCall("connect", port, address);
    if (res[0] != undefined) {
      throw new Error(res[0] as string);
    }
  }

  async close(): Promise<void> {
    await this.#apiCall("close");
  }

  async disconnect(): Promise<void> {
    await this.#apiCall("disconnect");
  }

  async dispose(): Promise<void> {
    await this.#apiCall("dispose");
    this.#messagePort.onmessage = null;
    this.#messagePort.close();
    this.#callbacks.clear();
  }

  async dropMembership(multicastAddress: string, multicastInterface?: string): Promise<void> {
    await this.#apiCall("dropMembership", multicastAddress, multicastInterface);
  }

  async dropSourceSpecificMembership(
    sourceAddress: string,
    groupAddress: string,
    multicastInterface?: string,
  ): Promise<void> {
    await this.#apiCall(
      "dropSourceSpecificMembership",
      sourceAddress,
      groupAddress,
      multicastInterface,
    );
  }

  async send(
    data: Uint8Array,
    offset?: number,
    length?: number,
    port?: number,
    address?: string,
    transfer = false, // eslint-disable-line @lichtblick/no-boolean-parameters
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      const callId = this.#nextCallId++;
      this.#callbacks.set(callId, () => {
        this.#callbacks.delete(callId);
        resolve();
      });
      const msg: RpcCall = ["send", callId, data, offset, length, port, address];
      if (transfer) {
        this.#messagePort.postMessage(msg, [data.buffer]);
      } else {
        this.#messagePort.postMessage(msg);
      }
    });
  }

  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  async setBroadcast(flag: boolean): Promise<void> {
    await this.#apiCall("setBroadcast", flag);
  }

  async setMulticastInterface(multicastInterface: string): Promise<void> {
    await this.#apiCall("setMulticastInterface", multicastInterface);
  }

  // eslint-disable-next-line @lichtblick/no-boolean-parameters
  async setMulticastLoopback(flag: boolean): Promise<void> {
    await this.#apiCall("setMulticastLoopback", flag);
  }

  async setMulticastTTL(ttl: number): Promise<void> {
    await this.#apiCall("setMulticastTTL", ttl);
  }

  async setRecvBufferSize(size: number): Promise<void> {
    await this.#apiCall("setRecvBufferSize", size);
  }

  async setSendBufferSize(size: number): Promise<void> {
    await this.#apiCall("setSendBufferSize", size);
  }

  async setTTL(ttl: number): Promise<void> {
    await this.#apiCall("setTTL", ttl);
  }

  async #apiCall(methodName: string, ...args: Cloneable[]): Promise<Cloneable[]> {
    return await new Promise((resolve) => {
      const callId = this.#nextCallId++;
      this.#callbacks.set(callId, (result) => {
        this.#callbacks.delete(callId);
        resolve(result);
      });
      const msg: RpcCall = [methodName, callId, ...args];
      this.#messagePort.postMessage(msg);
    });
  }
}
