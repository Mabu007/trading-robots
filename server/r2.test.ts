import { describe, expect, it } from 'vitest';
import { getR2Config } from './r2';

describe('R2 configuration', () => {
  it('requires all server-side credentials', () => {
    expect(getR2Config({} as NodeJS.ProcessEnv)).toBeNull();
    expect(getR2Config({ R2_ACCOUNT_ID: 'a', R2_ACCESS_KEY_ID: 'b', R2_SECRET_ACCESS_KEY: 'c', R2_BUCKET: 'd' } as NodeJS.ProcessEnv))
      .toEqual({ accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucket: 'd' });
  });
});
