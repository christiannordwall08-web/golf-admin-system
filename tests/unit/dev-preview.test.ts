import { describe, expect, it } from "vitest";
import { isDevPreviewEnabled, modeFromSegment } from "@/server/dev-preview";
import { normalizePersonName, previewEmailBase } from "@/server/dev-preview-profile";

const base = {
  DEV_PREVIEW: "1",
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://golf:golf@localhost:5433/golf_admin",
};

describe("isDevPreviewEnabled – förhandsvisning får aldrig kunna slås på i drift", () => {
  it("är på bara när alla villkor är uppfyllda", () => {
    expect(isDevPreviewEnabled(base)).toBe(true);
    expect(isDevPreviewEnabled({ ...base, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x" })).toBe(true);
    expect(isDevPreviewEnabled({ ...base, DATABASE_URL: "postgresql://u:p@[::1]:5432/x" })).toBe(true);
  });

  it("är AV i production även om DEV_PREVIEW=1 satts av misstag", () => {
    expect(isDevPreviewEnabled({ ...base, NODE_ENV: "production" })).toBe(false);
    expect(isDevPreviewEnabled({ ...base, NODE_ENV: "test" })).toBe(false);
    expect(isDevPreviewEnabled({ ...base, NODE_ENV: undefined })).toBe(false);
  });

  it("är AV utan uttrycklig DEV_PREVIEW=1", () => {
    expect(isDevPreviewEnabled({ ...base, DEV_PREVIEW: undefined })).toBe(false);
    expect(isDevPreviewEnabled({ ...base, DEV_PREVIEW: "true" })).toBe(false);
    expect(isDevPreviewEnabled({ ...base, DEV_PREVIEW: "0" })).toBe(false);
  });

  it("är AV mot en databas som inte är lokal", () => {
    expect(isDevPreviewEnabled({ ...base, DATABASE_URL: "postgresql://u:p@db.example.com:5432/prod" })).toBe(false);
    expect(isDevPreviewEnabled({ ...base, DATABASE_URL: "postgresql://u:p@localhost.evil.example/x" })).toBe(false);
    expect(isDevPreviewEnabled({ ...base, DATABASE_URL: "postgresql://u:p@10.0.0.5:5432/x" })).toBe(false);
  });

  it("är AV utan eller med ogiltig DATABASE_URL", () => {
    expect(isDevPreviewEnabled({ ...base, DATABASE_URL: undefined })).toBe(false);
    expect(isDevPreviewEnabled({ ...base, DATABASE_URL: "inte-en-url" })).toBe(false);
  });
});

describe("lägen och namn", () => {
  it("modeFromSegment tolkar bara admin, golfshop och bollplockare", () => {
    expect(modeFromSegment("admin")).toBe("admin");
    expect(modeFromSegment("Golfshop")).toBe("golfshop");
    expect(modeFromSegment("bollplockare")).toBe("bollplockare");
    expect(modeFromSegment("root")).toBeNull();
    expect(modeFromSegment("")).toBeNull();
  });

  it("normalizePersonName släpper igenom riktiga namn (även å ä ö) och avvisar skräp", () => {
    expect(normalizePersonName("  Åke   ")).toBe("Åke");
    expect(normalizePersonName("Anna-Lena")).toBe("Anna-Lena");
    expect(normalizePersonName("O'Brien")).toBe("O'Brien");
    expect(normalizePersonName("Maria  Del  Mar")).toBe("Maria Del Mar");
    for (const bad of ["", "   ", "123", "Anna<script>", "a".repeat(61), "-Anna", "Anna; DROP TABLE"]) {
      expect(normalizePersonName(bad)).toBeNull();
    }
  });

  it("e-postbasen rensar diakritiska tecken och specialtecken", () => {
    expect(previewEmailBase("Åke", "Öberg")).toBe("ake.oberg");
    expect(previewEmailBase("Anna-Lena", "Testsson")).toBe("annalena.testsson");
  });
});
