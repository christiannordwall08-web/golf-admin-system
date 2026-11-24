import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Filförvaring bakom ett litet gränssnitt, så att lokal disk kan bytas mot en molntjänst (S3 m.fl.) utan att resten
 * av appen ändras. Nycklar är relativa sökvägar byggda av appen, aldrig av användarens indata.
 * Filer läggs ALDRIG under /public: de når användare bara via en inloggad route som kontrollerar behörighet.
 */
export interface FileStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

const KEY = /^[a-z0-9][a-z0-9._/-]{0,250}$/;

export function assertSafeKey(key: string): void {
  if (!KEY.test(key) || key.includes("..") || key.includes("//") || key.endsWith("/")) {
    throw new RangeError("Ogiltig lagringsnyckel.");
  }
}

/** Lokal disk (utveckling och enkla driftsättningar). Rotmappen ignoreras av git och ligger utanför `public/`. */
export class LocalFileStorage implements FileStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new RangeError("Ogiltig lagringsnyckel.");
    return full;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes, { flag: "wx", mode: 0o600 }); // wx: skriv aldrig över en befintlig fil
  }

  async get(key: string): Promise<Uint8Array> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

let shared: FileStorage | undefined;
/** Appens förvaring. Mapp: STORAGE_DIR (standard `.storage` i projektet). */
export function getStorage(): FileStorage {
  shared ??= new LocalFileStorage(process.env.STORAGE_DIR ?? ".storage");
  return shared;
}
