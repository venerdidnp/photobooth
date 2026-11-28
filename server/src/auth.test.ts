import { describe, expect, it } from 'vitest';
import { checkBasicAuth } from './auth';

const header = (user: string, pass: string): string => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

describe('checkBasicAuth', () => {
  it('menerima user dan password yang benar', () => {
    expect(checkBasicAuth(header('operator', 's3cret'), 'operator', 's3cret')).toBe(true);
  });

  it('password boleh mengandung titik dua', () => {
    expect(checkBasicAuth(header('operator', 'a:b:c'), 'operator', 'a:b:c')).toBe(true);
  });

  it('menerima skema Basic tanpa peduli huruf besar-kecil', () => {
    expect(checkBasicAuth(header('operator', 's3cret').replace('Basic', 'basic'), 'operator', 's3cret')).toBe(true);
    expect(checkBasicAuth(header('operator', 's3cret').replace('Basic', 'BASIC'), 'operator', 's3cret')).toBe(true);
  });

  it('menolak user atau password yang salah', () => {
    expect(checkBasicAuth(header('operator', 'salah'), 'operator', 's3cret')).toBe(false);
    expect(checkBasicAuth(header('lain', 's3cret'), 'operator', 's3cret')).toBe(false);
    expect(checkBasicAuth(header('operator', 's3cret '), 'operator', 's3cret')).toBe(false);
  });

  it('menolak header kosong, bukan Basic, atau rusak', () => {
    expect(checkBasicAuth(undefined, 'operator', 's3cret')).toBe(false);
    expect(checkBasicAuth('', 'operator', 's3cret')).toBe(false);
    expect(checkBasicAuth('Bearer abc', 'operator', 's3cret')).toBe(false);
    expect(checkBasicAuth(`Basic ${Buffer.from('tanpa-titik-dua').toString('base64')}`, 'operator', 's3cret')).toBe(false);
  });
});
