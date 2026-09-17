declare module "ipaddr.js" {
  type ByteArray = [number, number, number, number];
  type IPv4Range = "unspecified" | "broadcast" | "multicast" | "linkLocal" | "loopback" | "carrierGradeNat" | "private" | "reserved";
  type IPv6Range = "unspecified" | "linkLocal" | "multicast" | "loopback" | "uniqueLocal" | "ipv4Mapped" | "rfc6145" | "rfc6052" | "6to4" | "teredo" | "reserved";
  type RangeList = IPv4Range | IPv6Range;
  type Kind = "ipv4" | "ipv6";

  interface IPv4 {
    kind(): "ipv4";
    toByteArray(): ByteArray;
    toNormalizedString(): string;
    toString(): string;
    range(): IPv4Range;
    match(range: IPv4 | IPv6 | IPv4RangeResult | IPv6RangeResult): boolean;
  }

  interface IPv6 {
    kind(): "ipv6";
    toByteArray(): ByteArray;
    toNormalizedString(): string;
    toFixedLengthString(): string;
    toString(): string;
    range(): IPv6Range;
    match(range: IPv4 | IPv6 | IPv4RangeResult | IPv6RangeResult): boolean;
  }

  type Address = IPv4 | IPv6;
  type RangeResult = IPv4RangeResult | IPv6RangeResult;
  type IPv4RangeResult = [IPv4, number];
  type IPv6RangeResult = [IPv6, number];

  function process(address: string): Address;
  function parse(address: string): Address;
  function parseCIDR(range: string): RangeResult;
  function isValid(address: string): boolean;

  const v4: {
    isValid: (address: string) => boolean;
    parse: (address: string) => IPv4;
  };

  const v6: {
    isValid: (address: string) => boolean;
    parse: (address: string) => IPv6;
  };

  function subnetMatch(address: Address, rangeList: Record<string, RangeList | string[]>, defaultName?: string): string;

  export type IPv4 = IPv4;
  export type IPv6 = IPv6;
  export type Address = Address;
  export type RangeList = RangeList;
  export type Kind = Kind;
  export type RangeResult = RangeResult;

  export { process, parse, parseCIDR, isValid, subnetMatch, v4, v6 };
}
