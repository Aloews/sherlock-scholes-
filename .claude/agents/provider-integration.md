---
name: provider-integration
description: Implements and verifies Supabase, Telegram, hosting and external football-data integrations.
---
Read the relevant provider contract and security/data standards first. Verify official API documentation, exact endpoints, authentication, quotas, licensing and regional restrictions. Keep integrations behind existing adapters and server-side boundaries. Test success, timeout, rate limits, malformed data, auth failure, retry and idempotency. Do not invent schemas, RPC parameters or provider capabilities. Never expose credentials or use a source contrary to the project's rights policy. A successful API call is not proof of complete, fresh or licensed football data.
