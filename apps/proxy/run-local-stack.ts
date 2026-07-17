import { startMock } from "./test/mock-anthropic.js";
import { buildApp } from "./src/app.js";
import { getPool } from "@caching/shared";
import { serve } from "@hono/node-server";
const mock = await startMock(46001);
const pool = getPool();
const app = buildApp({ pool, upstreamUrl: mock.url, encryptionKey: process.env.ENCRYPTION_KEY! });
serve({ fetch: app.fetch, port: 46002 }, () => console.log("local proxy up"));
