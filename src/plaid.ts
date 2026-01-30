import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import type { Config, PlaidMode } from './types.js';
import { getPlaidCredentials } from './lib/keychain.js';

/**
 * Get the Plaid environment URL for a given mode
 */
function getPlaidEnvironment(mode: PlaidMode): string {
  switch (mode) {
    case 'sandbox':
      return PlaidEnvironments.sandbox;
    case 'development':
      return PlaidEnvironments.development;
    default:
      return PlaidEnvironments.sandbox;
  }
}

/**
 * Create a Plaid client using credentials from the system keychain
 */
export async function createPlaidClient(config: Config): Promise<PlaidApi> {
  const credentials = await getPlaidCredentials();

  if (!credentials) {
    throw new Error('Plaid credentials not found in Keychain. Run "spend-pulse setup" first.');
  }

  const configuration = new Configuration({
    basePath: getPlaidEnvironment(config.plaid.mode),
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': credentials.clientId,
        'PLAID-SECRET': credentials.secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

/**
 * Create a Plaid client with explicitly provided credentials (used during setup)
 */
export function createPlaidClientWithCredentials(
  clientId: string,
  secret: string,
  mode: PlaidMode = 'sandbox'
): PlaidApi {
  const configuration = new Configuration({
    basePath: getPlaidEnvironment(mode),
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });

  return new PlaidApi(configuration);
}

export async function createLinkToken(client: PlaidApi, clientId: string): Promise<string> {
  const response = await client.linkTokenCreate({
    user: { client_user_id: 'spend-pulse-user' },
    client_name: 'Spend Pulse',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });

  return response.data.link_token;
}

export interface TokenExchangeResult {
  accessToken: string;
  itemId: string;
}

export async function exchangePublicToken(client: PlaidApi, publicToken: string): Promise<TokenExchangeResult> {
  const response = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });

  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

export { Products, CountryCode };
