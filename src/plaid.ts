import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from 'plaid';
import type { Config } from './types.js';

export function createPlaidClient(config: Config): PlaidApi {
  const configuration = new Configuration({
    basePath: PlaidEnvironments.sandbox, // Change to 'production' for real data
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': config.plaid.client_id,
        'PLAID-SECRET': config.plaid.secret,
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

export async function exchangePublicToken(client: PlaidApi, publicToken: string): Promise<string> {
  const response = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });

  return response.data.access_token;
}

export { Products, CountryCode };
