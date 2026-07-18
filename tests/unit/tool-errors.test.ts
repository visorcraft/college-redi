import { describe, expect, it, vi } from 'vitest';
import { errorResponse, ToolError } from '../../src/server/tools/errors';

describe('tool error responses', () => {
  it('keeps expected errors useful and hides unexpected internals', async () => {
    const expected = errorResponse(new ToolError('bad_request', 'fix this field'));
    expect(expected.status).toBe(400);
    expect(await expected.json()).toEqual({
      error: { code: 'bad_request', message: 'fix this field' },
    });

    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const unexpected = errorResponse(new Error('SELECT secret FROM internal_table'));
      expect(unexpected.status).toBe(500);
      expect(JSON.stringify(await unexpected.json())).not.toContain('internal_table');
      expect(log).toHaveBeenCalledWith(expect.not.stringContaining('internal_table'));
    } finally {
      log.mockRestore();
    }
  });
});
