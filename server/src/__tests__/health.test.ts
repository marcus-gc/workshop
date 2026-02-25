import "./setup.js";
import { describe, it, expect } from "vitest";
import { migrate } from "../db/schema.js";
import { request, json } from "./helpers.js";

migrate();

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await request("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ status: "ok" });
  });
});
