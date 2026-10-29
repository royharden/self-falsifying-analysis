import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalJson, sha256Bytes, sha256Text } from '../src/lib/falsify/canonical';

describe('SHA-256 (FIPS 180-2 vectors)', () => {
  it('hashes the standard vectors', () => {
    expect(sha256Text('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Bytes(new Uint8Array(1_000_000).fill(0x61))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});

describe('canonical JSON', () => {
  it('sorts keys, keeps array order and writes -0 as 0', () => {
    expect(canonicalJson({ b: 1, a: [-0, 1.5, 'x'], c: { z: null, y: true } })).toBe(
      '{"a":[0,1.5,"x"],"b":1,"c":{"y":true,"z":null}}',
    );
  });

  it('is stable under key order', () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it('rejects undefined and non-finite numbers', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson([Number.NaN])).toThrow();
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow();
    expect(() => canonicalJson(new Date(0))).toThrow();
    // eslint-disable-next-line no-sparse-arrays
    expect(() => canonicalJson([1, , 2])).toThrow();
  });
});
