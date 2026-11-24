import { describe, expect, it } from "vitest";
import {
  MAX_DAY_TOTAL_ORE,
  allowedClosingDates,
  closingStorageKey,
  detectImage,
  isAllowedClosingDate,
  parseDayTotal,
} from "@/domain/daily-closing";
import { LocalFileStorage, assertSafeKey } from "@/server/storage/file-storage";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("detectImage – typ avgörs av filens innehåll, inte namn eller angiven typ", () => {
  it("känner igen JPEG, PNG och WebP", () => {
    expect(detectImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(detectImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ mime: "image/png", ext: "png" });
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(detectImage(webp)).toEqual({ mime: "image/webp", ext: "webp" });
  });

  it("avvisar allt annat, även filer som utger sig för att vara bilder", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(detectImage(enc("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBeNull();
    expect(detectImage(enc("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(detectImage(enc("%PDF-1.7"))).toBeNull();
    expect(detectImage(enc("GIF89a"))).toBeNull();
    expect(detectImage(Uint8Array.from([0x4d, 0x5a, 0x90, 0]))).toBeNull(); // körbar fil
    expect(detectImage(new Uint8Array())).toBeNull();
    expect(detectImage(Uint8Array.from([0xff, 0xd8]))).toBeNull(); // för kort
  });
});

describe("parseDayTotal – dagens summa i kronor", () => {
  it("tolkar vanliga skrivsätt till ören", () => {
    expect(parseDayTotal("12345")).toEqual({ ok: true, ore: 1_234_500 });
    expect(parseDayTotal("12 345,50")).toEqual({ ok: true, ore: 1_234_550 });
    expect(parseDayTotal("12 345.5 kr")).toEqual({ ok: true, ore: 1_234_550 });
    expect(parseDayTotal("0")).toEqual({ ok: true, ore: 0 });
  });

  it("avvisar tomt, negativt, text, för många decimaler och orimliga belopp", () => {
    for (const bad of ["", "  ", "-5", "abc", "12,345", "1e5", "12 kr kr"]) expect(parseDayTotal(bad).ok).toBe(false);
    expect(parseDayTotal("10000000").ok).toBe(true);
    expect(parseDayTotal("10000001").ok).toBe(false);
    expect(MAX_DAY_TOTAL_ORE).toBe(1_000_000_000);
  });
});

describe("datum och lagringsnyckel", () => {
  it("godtar idag och tre dagar bakåt, aldrig framåt", () => {
    expect(allowedClosingDates("2026-11-24")).toEqual(["2026-11-24", "2026-11-23", "2026-11-22", "2026-11-21"]);
    expect(isAllowedClosingDate("2026-11-21", "2026-11-24")).toBe(true);
    expect(isAllowedClosingDate("2026-11-20", "2026-11-24")).toBe(false);
    expect(isAllowedClosingDate("2026-11-25", "2026-11-24")).toBe(false);
    expect(allowedClosingDates("2026-03-02")[3]).toBe("2026-02-27");
  });

  it("nyckeln är mappstruktur år/månad/dag och går aldrig att styra med indata", () => {
    const id = "0b7e1c52-6e0f-4d2c-9a38-1f2f4e5a6b7c";
    expect(closingStorageKey("2026-11-24", id, "jpg")).toBe(`dagsavslut/2026/11/24/dagsavslut-${id}.jpg`);
    expect(() => closingStorageKey("2026-11-24", "../../etc/passwd", "jpg")).toThrow();
    expect(() => closingStorageKey("2026/11/24", id, "jpg")).toThrow();
  });
});

describe("LocalFileStorage", () => {
  it("lagrar och läser filer, skriver aldrig över, och släpper aldrig ut sig ur rotmappen", async () => {
    const storage = new LocalFileStorage(mkdtempSync(join(tmpdir(), "golf-storage-")));
    await storage.put("dagsavslut/2026/11/24/a.jpg", Uint8Array.from([1, 2, 3]));
    expect([...(await storage.get("dagsavslut/2026/11/24/a.jpg"))]).toEqual([1, 2, 3]);
    await expect(storage.put("dagsavslut/2026/11/24/a.jpg", Uint8Array.from([9]))).rejects.toThrow(); // finns redan
    await storage.delete("dagsavslut/2026/11/24/a.jpg");
    await expect(storage.get("dagsavslut/2026/11/24/a.jpg")).rejects.toThrow();
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "a//b", "A/B", "", "a/", "a b"]) {
      expect(() => assertSafeKey(bad)).toThrow();
      await expect(storage.put(bad, Uint8Array.from([1]))).rejects.toThrow();
    }
  });
});
