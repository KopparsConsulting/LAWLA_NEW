/** Anteckningar per rättskälla i en utredning (en per flik i arbetsytan). */
export interface SourceNote {
  /** Flikens nyckel, t.ex. "l/2005:716", "d12", "r/GS03170". */
  sourceKey: string;
  text: string;
  updatedAt: string;
  updatedBy: string | null;
}

export const NOTE_MAX = 20_000;
export const NOTE_KEY_RE = /^(d\d{1,10}|l\/[^\s#?]{1,200}|r\/[A-Z0-9]{4,20})$/;
