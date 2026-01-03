/**
 * API Key Authentication and User Management
 *
 * In production, this would connect to a database.
 * For now, we use a simple in-memory store and environment-based keys.
 */

export interface User {
  id: string;
  apiKey: string;
  phoneNumber: string;
  createdAt: Date;
  enabled: boolean;
}

// In production, this would be a database
const users = new Map<string, User>();

// Load API keys from environment (format: API_KEY_xxx=phone_number)
export function loadApiKeys(): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('API_KEY_')) {
      const apiKey = key.replace('API_KEY_', '');
      users.set(apiKey, {
        id: apiKey.substring(0, 8),
        apiKey,
        phoneNumber: value!,
        createdAt: new Date(),
        enabled: true,
      });
      console.error(`Loaded API key: ${apiKey.substring(0, 8)}...`);
    }
  }
  console.error(`Total API keys loaded: ${users.size}`);
}

export function validateApiKey(apiKey: string): User | null {
  const user = users.get(apiKey);
  if (!user || !user.enabled) {
    return null;
  }
  return user;
}

export function getUserByApiKey(apiKey: string): User | null {
  return users.get(apiKey) || null;
}

export function getAllUsers(): User[] {
  return Array.from(users.values());
}
