import { createLocalSandboxProviderService } from '../src/enterprise/local-sandbox-provider-service.mjs';

const storePath = process.env.ORGWARD_LOCAL_SANDBOX_STATE;
const token = process.env.ORGWARD_LOCAL_SANDBOX_TOKEN;
if (!storePath) throw new Error('Set ORGWARD_LOCAL_SANDBOX_STATE to a private durable JSON file path.');
if (!token || token.length < 32) throw new Error('Set ORGWARD_LOCAL_SANDBOX_TOKEN to a shared value of at least 32 characters.');
const port = Number(process.env.ORGWARD_LOCAL_SANDBOX_PORT ?? 7310);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('ORGWARD_LOCAL_SANDBOX_PORT must be an integer from 0 through 65535.');
const service = await createLocalSandboxProviderService({ storePath, token, port });
process.stdout.write(`Local test-only sandbox service listening at ${service.url}\n`);
const stop = async () => { await service.close(); process.exit(0); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
