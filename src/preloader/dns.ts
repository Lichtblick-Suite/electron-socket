import dns from "dns";

import { MDnsResolver } from "./MDnsResolver.js";

const mdnsResolver = new MDnsResolver();

const getaddrinfo = dns.lookup.bind(dns);

export function dnsLookup(
  hostname: string,
  options: dns.LookupOneOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void {
  if (!hostname.endsWith(".local")) {
    getaddrinfo(hostname, options, callback);
  } else {
    void mdnsLookup(hostname, options, callback);
  }
}

export async function mdnsLookup(
  hostname: string,
  options: dns.LookupOneOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): Promise<void> {
  const response = await mdnsResolver.mdnsLookup(hostname, options);
  if (response == undefined) {
    callback(new Error(`mDNS resolution timed out for "${hostname}"`), "", 0);
    return;
  }
  callback(null, response.address, response.family);
}
