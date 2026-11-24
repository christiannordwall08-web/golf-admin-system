import { describe, expect, it } from "vitest";
import { assertLocalDevelopment } from "@/server/local-guard";

const local = "postgresql://golf:golf@localhost:5433/golf_admin";

describe("assertLocalDevelopment – import och testdata får bara köras lokalt", () => {
  it("släpper igenom lokal databas i utveckling", () => {
    expect(() => assertLocalDevelopment(local, { NODE_ENV: "development" })).not.toThrow();
    expect(() => assertLocalDevelopment("postgresql://u:p@127.0.0.1:5432/x", {})).not.toThrow();
    expect(() => assertLocalDevelopment("postgresql://u:p@[::1]:5432/x", {})).not.toThrow();
  });

  it("vägrar i production", () => {
    expect(() => assertLocalDevelopment(local, { NODE_ENV: "production" })).toThrow(/production/);
  });

  it("vägrar mot icke-lokal eller ogiltig databas", () => {
    expect(() => assertLocalDevelopment("postgresql://u:p@db.example.com:5432/prod", {})).toThrow(/icke-lokal/);
    expect(() => assertLocalDevelopment("postgresql://u:p@localhost.evil.example/x", {})).toThrow(/icke-lokal/);
    expect(() => assertLocalDevelopment("inte-en-url", {})).toThrow(/ogiltig/);
  });
});
