import { getPool } from "@caching/shared";
import type pg from "pg";

export function db(): pg.Pool {
  return getPool();
}
