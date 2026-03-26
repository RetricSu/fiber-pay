declare module 'macaroon' {
  export interface MacaroonCaveat {
    identifier: Uint8Array;
    location?: string;
    vid?: Uint8Array;
  }

  export interface Macaroon {
    identifier: Uint8Array;
    location: string;
    signature: Uint8Array;
    caveats: MacaroonCaveat[];

    addFirstPartyCaveat(caveatId: string | Uint8Array): void;
    addThirdPartyCaveat(
      rootKeyBytes: Uint8Array,
      caveatIdBytes: string | Uint8Array,
      locationStr?: string,
    ): void;
    verify(
      rootKey: Uint8Array,
      caveatCheck: (caveat: string) => string | null,
      discharges: Macaroon[],
    ): void;
    exportJSON(): {
      v: number;
      l: string;
      i: string;
      c?: { i: string }[];
      s64: string;
    };
    exportBinary(): Uint8Array;
  }

  export interface NewMacaroonParams {
    rootKey: Uint8Array;
    identifier: string;
    location: string;
  }

  export function newMacaroon(params: NewMacaroonParams): Macaroon;

  export function importMacaroon(obj: unknown): Macaroon;
  export function importMacaroon(binary: Uint8Array): Macaroon;

  export function importMacaroons(obj: unknown): Macaroon[];

  export function dischargeMacaroon(
    macaroon: Macaroon,
    getDischarge: (location: string, thirdPartyCaveatId: string) => Promise<Macaroon>,
    onOk: (discharges: Macaroon[]) => void,
    onError: (error: Error) => void,
  ): void;

  export function bytesToBase64(bytes: Uint8Array): string;
  export function base64ToBytes(base64: string): Uint8Array;
}
