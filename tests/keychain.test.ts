import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock keytar before importing keychain
const mockKeytar = {
  setPassword: vi.fn(),
  getPassword: vi.fn(),
  deletePassword: vi.fn(),
  findCredentials: vi.fn(),
};

vi.mock('keytar', () => ({
  default: mockKeytar,
}));

// Import after mocking
const keychainModule = await import('../src/lib/keychain.js');
const {
  setPlaidCredentials,
  getPlaidCredentials,
  setAccessToken,
  getAccessToken,
  deleteAccessToken,
  hasPlaidCredentials,
  hasAccessToken,
  getAllStoredCredentials,
} = keychainModule;

describe('keychain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setPlaidCredentials', () => {
    it('should store client_id and secret', async () => {
      await setPlaidCredentials('client-abc', 'secret-xyz');

      expect(mockKeytar.setPassword).toHaveBeenCalledTimes(2);
      expect(mockKeytar.setPassword).toHaveBeenCalledWith('spend-pulse', 'plaid-client-id', 'client-abc');
      expect(mockKeytar.setPassword).toHaveBeenCalledWith('spend-pulse', 'plaid-secret', 'secret-xyz');
    });
  });

  describe('getPlaidCredentials', () => {
    it('should return credentials when both exist', async () => {
      mockKeytar.getPassword
        .mockResolvedValueOnce('client-abc')
        .mockResolvedValueOnce('secret-xyz');

      const result = await getPlaidCredentials();

      expect(result).toEqual({
        clientId: 'client-abc',
        secret: 'secret-xyz',
      });
    });

    it('should return null when client_id is missing', async () => {
      mockKeytar.getPassword
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('secret-xyz');

      const result = await getPlaidCredentials();

      expect(result).toBeNull();
    });

    it('should return null when secret is missing', async () => {
      mockKeytar.getPassword
        .mockResolvedValueOnce('client-abc')
        .mockResolvedValueOnce(null);

      const result = await getPlaidCredentials();

      expect(result).toBeNull();
    });
  });

  describe('setAccessToken', () => {
    it('should store access token with item_id suffix', async () => {
      await setAccessToken('item-123', 'access-token-abc');

      expect(mockKeytar.setPassword).toHaveBeenCalledWith(
        'spend-pulse',
        'plaid-access-token-item-123',
        'access-token-abc'
      );
    });
  });

  describe('getAccessToken', () => {
    it('should retrieve access token by item_id', async () => {
      mockKeytar.getPassword.mockResolvedValueOnce('access-token-abc');

      const result = await getAccessToken('item-123');

      expect(mockKeytar.getPassword).toHaveBeenCalledWith(
        'spend-pulse',
        'plaid-access-token-item-123'
      );
      expect(result).toBe('access-token-abc');
    });

    it('should return null for non-existent token', async () => {
      mockKeytar.getPassword.mockResolvedValueOnce(null);

      const result = await getAccessToken('item-nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('deleteAccessToken', () => {
    it('should delete access token by item_id', async () => {
      mockKeytar.deletePassword.mockResolvedValueOnce(true);

      const result = await deleteAccessToken('item-123');

      expect(mockKeytar.deletePassword).toHaveBeenCalledWith(
        'spend-pulse',
        'plaid-access-token-item-123'
      );
      expect(result).toBe(true);
    });
  });

  describe('hasPlaidCredentials', () => {
    it('should return true when credentials exist', async () => {
      mockKeytar.getPassword
        .mockResolvedValueOnce('client-abc')
        .mockResolvedValueOnce('secret-xyz');

      const result = await hasPlaidCredentials();

      expect(result).toBe(true);
    });

    it('should return false when credentials are missing', async () => {
      mockKeytar.getPassword.mockResolvedValue(null);

      const result = await hasPlaidCredentials();

      expect(result).toBe(false);
    });
  });

  describe('hasAccessToken', () => {
    it('should return true when token exists', async () => {
      mockKeytar.getPassword.mockResolvedValueOnce('token-abc');

      const result = await hasAccessToken('item-123');

      expect(result).toBe(true);
    });

    it('should return false when token is missing', async () => {
      mockKeytar.getPassword.mockResolvedValueOnce(null);

      const result = await hasAccessToken('item-123');

      expect(result).toBe(false);
    });
  });

  describe('getAllStoredCredentials', () => {
    it('should return all credentials from keytar', async () => {
      const mockCreds = [
        { account: 'plaid-client-id', password: 'client-abc' },
        { account: 'plaid-secret', password: 'secret-xyz' },
        { account: 'plaid-access-token-item-1', password: 'token-1' },
      ];
      mockKeytar.findCredentials.mockResolvedValueOnce(mockCreds);

      const result = await getAllStoredCredentials();

      expect(mockKeytar.findCredentials).toHaveBeenCalledWith('spend-pulse');
      expect(result).toEqual(mockCreds);
    });
  });
});
