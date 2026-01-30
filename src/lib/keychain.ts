import keytar from 'keytar';

const SERVICE_NAME = 'spend-pulse';

// Key names for different credential types
const KEYS = {
  clientId: 'plaid-client-id',
  secret: 'plaid-secret',
  accessToken: (itemId: string) => `plaid-access-token-${itemId}`,
};

export interface PlaidCredentials {
  clientId: string;
  secret: string;
}

export interface AccessTokenInfo {
  itemId: string;
  accessToken: string;
}

/**
 * Store Plaid client credentials in the system keychain
 */
export async function setPlaidCredentials(clientId: string, secret: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, KEYS.clientId, clientId);
  await keytar.setPassword(SERVICE_NAME, KEYS.secret, secret);
}

/**
 * Retrieve Plaid client credentials from the system keychain
 */
export async function getPlaidCredentials(): Promise<PlaidCredentials | null> {
  const clientId = await keytar.getPassword(SERVICE_NAME, KEYS.clientId);
  const secret = await keytar.getPassword(SERVICE_NAME, KEYS.secret);

  if (!clientId || !secret) {
    return null;
  }

  return { clientId, secret };
}

/**
 * Store an access token for a specific Plaid item in the system keychain
 */
export async function setAccessToken(itemId: string, accessToken: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, KEYS.accessToken(itemId), accessToken);
}

/**
 * Retrieve an access token for a specific Plaid item from the system keychain
 */
export async function getAccessToken(itemId: string): Promise<string | null> {
  return keytar.getPassword(SERVICE_NAME, KEYS.accessToken(itemId));
}

/**
 * Delete an access token for a specific Plaid item from the system keychain
 */
export async function deleteAccessToken(itemId: string): Promise<boolean> {
  return keytar.deletePassword(SERVICE_NAME, KEYS.accessToken(itemId));
}

/**
 * Delete all Plaid credentials from the system keychain
 */
export async function deleteAllCredentials(): Promise<void> {
  await keytar.deletePassword(SERVICE_NAME, KEYS.clientId);
  await keytar.deletePassword(SERVICE_NAME, KEYS.secret);
}

/**
 * Check if Plaid credentials exist in the keychain
 */
export async function hasPlaidCredentials(): Promise<boolean> {
  const credentials = await getPlaidCredentials();
  return credentials !== null;
}

/**
 * Check if an access token exists for a specific item
 */
export async function hasAccessToken(itemId: string): Promise<boolean> {
  const token = await getAccessToken(itemId);
  return token !== null;
}

/**
 * Get all stored access tokens (for migration/debugging)
 * Note: This returns all credentials stored under the service name
 */
export async function getAllStoredCredentials(): Promise<Array<{ account: string; password: string }>> {
  return keytar.findCredentials(SERVICE_NAME);
}
